package exec

import (
	"context"
	"strings"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/structpb"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
	"github.com/mcpstudio/mcp_studio/orchestrator/internal/registry"
)

// a linear pipeline in the shape the canvas saves it
const demoGraph = `{
  "nodes": [
    {"id":"b","data":{"manifestId":"gemini-notes"},"config":{"model":"gemini-3.5-flash-lite"}},
    {"id":"a","data":{"manifestId":"groq-transcribe"},"config":{}},
    {"id":"src","data":{"manifestId":"youtube-download"},"config":{"url":"x"}},
    {"id":"conv","data":{"manifestId":"format-converter","hop":{"from":"video/mp4","to":"audio/mpeg"}}}
  ],
  "edges": [
    {"source":"src","sourceHandle":"video_out","target":"conv","targetHandle":"media_in"},
    {"source":"conv","sourceHandle":"media_out","target":"a","targetHandle":"audio_in"},
    {"source":"a","sourceHandle":"transcript","target":"b","targetHandle":"transcript_in",
     "data":{"mapping":[{"from":"text","to":"text"},{"from":"language","to":"language"}]}}
  ]
}`

func TestOrderPutsUpstreamFirst(t *testing.T) {
	g, err := ParseGraph(demoGraph)
	if err != nil {
		t.Fatal(err)
	}
	order, err := g.Order()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, n := range order {
		ids = append(ids, n.ID)
	}
	if got := strings.Join(ids, ","); got != "src,conv,a,b" {
		t.Fatalf("order = %s, want src,conv,a,b", got)
	}
}

func TestOrderDetectsCycle(t *testing.T) {
	g, _ := ParseGraph(`{"nodes":[{"id":"x"},{"id":"y"}],"edges":[{"source":"x","target":"y"},{"source":"y","target":"x"}]}`)
	if _, err := g.Order(); err == nil {
		t.Fatal("expected a cycle error")
	}
}

func TestValidateCatchesUnconnectedInput(t *testing.T) {
	g, _ := ParseGraph(`{"nodes":[{"id":"a","data":{"manifestId":"groq-transcribe"}}],"edges":[]}`)
	err := g.Validate(registry.ByID())
	if err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("want a not-connected error, got %v", err)
	}
}

func TestValidateRejectsUnknownNodeType(t *testing.T) {
	g, _ := ParseGraph(`{"nodes":[{"id":"a","data":{"manifestId":"nope"}}],"edges":[]}`)
	if err := g.Validate(registry.ByID()); err == nil {
		t.Fatal("expected an unknown-type error")
	}
}

func TestApplyMappingRenamesAndDrops(t *testing.T) {
	st, _ := structpb.NewStruct(map[string]any{"text": "hi", "language": "en", "duration_sec": 12.0})
	in := &mcpstudiov1.NodeIO{Payload: &mcpstudiov1.NodeIO_JsonValue{JsonValue: st}}
	out := ApplyMapping(in, []FieldMap{{From: "text", To: "body"}, {From: "language", To: "language"}}).GetJsonValue().AsMap()
	if out["body"] != "hi" || out["language"] != "en" {
		t.Fatalf("mapped fields wrong: %v", out)
	}
	if _, kept := out["duration_sec"]; kept {
		t.Fatal("an unmapped field should be dropped")
	}
}

// fakeRunner succeeds with a canned output per node, or fails the node named in failOn
type fakeRunner struct{ failOn string }

func (f fakeRunner) Run(ctx context.Context, req *mcpstudiov1.ExecuteNodeRequest, emit func(*mcpstudiov1.NodeEvent)) error {
	if req.NodeId == f.failOn {
		emit(&mcpstudiov1.NodeEvent{NodeId: req.NodeId, Status: mcpstudiov1.NodeEvent_STATUS_FAILED, Error: "boom"})
		return nil
	}
	st, _ := structpb.NewStruct(map[string]any{"text": "t", "language": "en", "duration_sec": 1.0})
	emit(&mcpstudiov1.NodeEvent{
		NodeId: req.NodeId, Status: mcpstudiov1.NodeEvent_STATUS_SUCCEEDED, Detail: "ok " + req.NodeId,
		Outputs: map[string]*mcpstudiov1.NodeIO{
			"video_out": {Payload: &mcpstudiov1.NodeIO_BlobRef{BlobRef: &mcpstudiov1.BlobRef{Uri: "/x"}}},
			"media_out": {Payload: &mcpstudiov1.NodeIO_BlobRef{BlobRef: &mcpstudiov1.BlobRef{Uri: "/y"}}},
			"transcript": {Payload: &mcpstudiov1.NodeIO_JsonValue{JsonValue: st}},
			"email_out":  {Payload: &mcpstudiov1.NodeIO_JsonValue{JsonValue: st}},
		},
	})
	return nil
}

type fakeSecrets struct{}

func (fakeSecrets) GetSecret(ctx context.Context, nodeID, field string) (string, error) {
	return "secret-" + field, nil
}

func collect(t *testing.T, m *Manager, runID string) []*mcpstudiov1.RunEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var evs []*mcpstudiov1.RunEvent
	if err := m.Watch(ctx, runID, func(e *mcpstudiov1.RunEvent) error { evs = append(evs, e); return nil }); err != nil {
		t.Fatal(err)
	}
	return evs
}

func TestRunSucceedsInOrderAndEndsWithRunVerdict(t *testing.T) {
	m := NewManager(fakeRunner{}, fakeSecrets{}, registry.ByID())
	id, err := m.Start(demoGraph)
	if err != nil {
		t.Fatal(err)
	}
	evs := collect(t, m, id)
	last := evs[len(evs)-1]
	if last.NodeId != "" || last.Status != "succeeded" {
		t.Fatalf("last event = %v, want a run-level succeeded", last)
	}
	var running []string
	for _, e := range evs {
		if e.Status == "running" {
			running = append(running, e.NodeId)
		}
	}
	if strings.Join(running, ",") != "src,conv,a,b" {
		t.Fatalf("ran in order %v", running)
	}
}

func TestFailedNodeStopsTheRun(t *testing.T) {
	m := NewManager(fakeRunner{failOn: "a"}, fakeSecrets{}, registry.ByID())
	id, _ := m.Start(demoGraph)
	evs := collect(t, m, id)
	for _, e := range evs {
		if e.NodeId == "b" && e.Status == "running" {
			t.Fatal("a node after the failure must not run")
		}
	}
	if last := evs[len(evs)-1]; last.NodeId != "" || last.Status != "failed" {
		t.Fatalf("last event = %v, want run-level failed", last)
	}
}

func TestLateWatcherGetsTheReplay(t *testing.T) {
	m := NewManager(fakeRunner{}, fakeSecrets{}, registry.ByID())
	id, _ := m.Start(demoGraph)
	collect(t, m, id)
	if again := collect(t, m, id); len(again) == 0 {
		t.Fatal("a watcher joining after the run should still see its events")
	}
}
