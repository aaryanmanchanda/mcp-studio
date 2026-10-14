// running a pipeline: one node at a time, in order, streaming status to anyone watching.
// runs live in memory only for the PoC, a restart forgets them.
package exec

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
)

// NodeRunner runs one node and reports its events. the grpc client is one implementation, tests use a fake.
type NodeRunner interface {
	Run(ctx context.Context, req *mcpstudiov1.ExecuteNodeRequest, emit func(*mcpstudiov1.NodeEvent)) error
}

// Secrets hands the executor a decrypted credential for a single node call
type Secrets interface {
	GetSecret(ctx context.Context, nodeID, field string) (string, error)
}

type run struct {
	mu     sync.Mutex
	cond   *sync.Cond
	events []*mcpstudiov1.RunEvent
	done   bool
}

type Manager struct {
	runner   NodeRunner
	secrets  Secrets
	registry map[string]*mcpstudiov1.NodeManifest

	mu   sync.Mutex
	runs map[string]*run
}

func NewManager(runner NodeRunner, secrets Secrets, registry map[string]*mcpstudiov1.NodeManifest) *Manager {
	return &Manager{runner: runner, secrets: secrets, registry: registry, runs: map[string]*run{}}
}

func newRunID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (r *run) emit(nodeID, status, detail string) {
	r.mu.Lock()
	r.events = append(r.events, &mcpstudiov1.RunEvent{NodeId: nodeID, Status: status, Detail: detail})
	r.mu.Unlock()
	r.cond.Broadcast() // wake every watcher
}

func (r *run) finish() {
	r.mu.Lock()
	r.done = true
	r.mu.Unlock()
	r.cond.Broadcast()
}

// Start validates synchronously (so the user gets a real error back), then runs in the background
func (m *Manager) Start(graphJSON string) (string, error) {
	g, err := ParseGraph(graphJSON)
	if err != nil {
		return "", err
	}
	if err := g.Validate(m.registry); err != nil {
		return "", err
	}
	order, err := g.Order()
	if err != nil {
		return "", err
	}

	id := newRunID()
	r := &run{}
	r.cond = sync.NewCond(&r.mu)
	m.mu.Lock()
	m.runs[id] = r
	m.mu.Unlock()

	go m.execute(id, g, order, r)
	return id, nil
}

func (m *Manager) execute(runID string, g *Graph, order []*Node, r *run) {
	defer r.finish()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	for _, n := range order {
		r.emit(n.ID, "queued", "")
	}

	outputs := map[string]map[string]*mcpstudiov1.NodeIO{} // nodeID -> output name -> value
	for _, n := range order {
		r.emit(n.ID, "running", "")

		req, err := m.buildRequest(ctx, runID, g, n, outputs)
		if err != nil {
			r.emit(n.ID, "failed", err.Error())
			r.emit("", "failed", fmt.Sprintf("%s failed", n.Data.ManifestID))
			return
		}

		failed := ""
		detail := ""
		err = m.runner.Run(ctx, req, func(ev *mcpstudiov1.NodeEvent) {
			switch ev.Status {
			case mcpstudiov1.NodeEvent_STATUS_FAILED:
				failed = ev.Error
				if failed == "" {
					failed = "node failed"
				}
			case mcpstudiov1.NodeEvent_STATUS_SUCCEEDED:
				outputs[n.ID] = ev.Outputs
				detail = ev.Detail
			}
		})
		if err != nil && failed == "" {
			failed = "runner error: " + err.Error() // couldn't reach the runner, wrong address, it crashed
		}
		if failed != "" {
			r.emit(n.ID, "failed", failed)
			r.emit("", "failed", fmt.Sprintf("%s failed", n.Data.ManifestID))
			return
		}
		r.emit(n.ID, "succeeded", detail)
	}
	r.emit("", "succeeded", "pipeline finished")
}

// buildRequest assembles one node call: wired-in inputs, plain config, and the decrypted secrets
func (m *Manager) buildRequest(ctx context.Context, runID string, g *Graph, n *Node, outputs map[string]map[string]*mcpstudiov1.NodeIO) (*mcpstudiov1.ExecuteNodeRequest, error) {
	manifest := m.registry[n.Data.ManifestID]

	inputs := map[string]*mcpstudiov1.NodeIO{}
	for _, e := range g.Edges {
		if e.Target != n.ID {
			continue
		}
		val, ok := outputs[e.Source][e.SourceHandle]
		if !ok {
			return nil, fmt.Errorf("upstream node produced no %q output", e.SourceHandle)
		}
		inputs[e.TargetHandle] = ApplyMapping(val, e.Data.Mapping)
	}

	config := map[string]string{}
	for k, v := range n.Config {
		config[k] = v
	}
	if n.Data.Hop != nil { // converter nodes carry which conversion they perform
		config["hop_from"] = n.Data.Hop.From
		config["hop_to"] = n.Data.Hop.To
	}
	for _, f := range manifest.ConfigFields {
		if !f.Secret {
			continue
		}
		v, err := m.secrets.GetSecret(ctx, n.ID, f.Name)
		if err != nil {
			return nil, fmt.Errorf("%s is not set, enter it in the config panel", f.Name)
		}
		config[f.Name] = v
	}

	return &mcpstudiov1.ExecuteNodeRequest{
		NodeId:     n.ID,
		ManifestId: n.Data.ManifestID,
		Inputs:     inputs,
		Config:     config,
		RunId:      runID,
	}, nil
}

// Watch replays everything that already happened, then follows live until the run ends
func (m *Manager) Watch(ctx context.Context, runID string, send func(*mcpstudiov1.RunEvent) error) error {
	m.mu.Lock()
	r := m.runs[runID]
	m.mu.Unlock()
	if r == nil {
		return fmt.Errorf("unknown run %s", runID)
	}

	// cond.Wait can't see ctx, so a watcher that disconnects wakes itself up
	stop := context.AfterFunc(ctx, func() { r.cond.Broadcast() })
	defer stop()

	sent := 0
	r.mu.Lock()
	defer r.mu.Unlock()
	for {
		for sent < len(r.events) {
			ev := r.events[sent]
			sent++
			r.mu.Unlock()
			err := send(ev)
			r.mu.Lock()
			if err != nil {
				return err
			}
		}
		if r.done {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		r.cond.Wait()
	}
}
