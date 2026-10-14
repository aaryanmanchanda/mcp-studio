// turning a saved canvas into an ordered list of nodes to run.
// the canvas saves react flow's own node/edge objects, so these structs only pick out the fields the executor needs.
package exec

import (
	"encoding/json"
	"fmt"

	"google.golang.org/protobuf/types/known/structpb"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
)

type Hop struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Node struct {
	ID   string `json:"id"`
	Data struct {
		ManifestID string `json:"manifestId"`
		Hop        *Hop   `json:"hop"` // only set on converter nodes the BFS inserted
	} `json:"data"`
	Config map[string]string `json:"config"` // non-secret values only, secrets come from the vault at run time
}

type FieldMap struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Edge struct {
	Source       string `json:"source"`
	SourceHandle string `json:"sourceHandle"`
	Target       string `json:"target"`
	TargetHandle string `json:"targetHandle"`
	Data         struct {
		Mapping []FieldMap `json:"mapping"` // frozen onto the wire when the shape adapter was made
	} `json:"data"`
}

type Graph struct {
	Nodes []Node `json:"nodes"`
	Edges []Edge `json:"edges"`
}

func ParseGraph(graphJSON string) (*Graph, error) {
	var g Graph
	if err := json.Unmarshal([]byte(graphJSON), &g); err != nil {
		return nil, fmt.Errorf("pipeline is not valid json: %w", err)
	}
	return &g, nil
}

// Validate catches the mistakes a user can make on the canvas before anything runs:
// unknown node types, dangling wires, inputs nobody feeds
func (g *Graph) Validate(registry map[string]*mcpstudiov1.NodeManifest) error {
	if len(g.Nodes) == 0 {
		return fmt.Errorf("the pipeline has no nodes")
	}
	ids := map[string]*Node{}
	for i := range g.Nodes {
		n := &g.Nodes[i]
		if _, ok := registry[n.Data.ManifestID]; !ok {
			return fmt.Errorf("node %s has unknown type %q", n.ID, n.Data.ManifestID)
		}
		ids[n.ID] = n
	}
	fed := map[string]bool{} // "nodeID/inputName" -> has a wire into it
	for _, e := range g.Edges {
		if ids[e.Source] == nil || ids[e.Target] == nil {
			return fmt.Errorf("a wire points at a node that doesn't exist")
		}
		fed[e.Target+"/"+e.TargetHandle] = true
	}
	for _, n := range g.Nodes {
		for _, in := range registry[n.Data.ManifestID].Inputs {
			if !fed[n.ID+"/"+in.Name] {
				return fmt.Errorf("%s: input %q is not connected", n.Data.ManifestID, in.Name)
			}
		}
	}
	return nil
}

// Order is kahn's algorithm: repeatedly take the nodes with no unfinished upstream.
// ties keep the saved node order so a run is the same every time. a leftover means a cycle.
func (g *Graph) Order() ([]*Node, error) {
	indegree := map[string]int{}
	for _, n := range g.Nodes {
		indegree[n.ID] = 0
	}
	for _, e := range g.Edges {
		indegree[e.Target]++
	}
	var out []*Node
	done := map[string]bool{}
	for len(out) < len(g.Nodes) {
		progressed := false
		for i := range g.Nodes {
			n := &g.Nodes[i]
			if done[n.ID] || indegree[n.ID] != 0 {
				continue
			}
			out = append(out, n)
			done[n.ID] = true
			progressed = true
			for _, e := range g.Edges {
				if e.Source == n.ID {
					indegree[e.Target]--
				}
			}
			break // restart the scan so the earliest ready node always goes first
		}
		if !progressed {
			return nil, fmt.Errorf("the pipeline has a cycle")
		}
	}
	return out, nil
}

// ApplyMapping renames a json payload's fields along a shape-adapter wire.
// fields with no mapping are dropped, which is exactly what the inspector told the user.
func ApplyMapping(in *mcpstudiov1.NodeIO, mapping []FieldMap) *mcpstudiov1.NodeIO {
	src := in.GetJsonValue()
	if src == nil || len(mapping) == 0 {
		return in // blobs and unmapped wires pass through untouched
	}
	out := map[string]any{}
	for _, m := range mapping {
		if v, ok := src.Fields[m.From]; ok {
			out[m.To] = v.AsInterface()
		}
	}
	st, err := structpb.NewStruct(out)
	if err != nil {
		return in
	}
	return &mcpstudiov1.NodeIO{Payload: &mcpstudiov1.NodeIO_JsonValue{JsonValue: st}}
}
