// e2e: a headless stand-in for the canvas. saves the demo pipeline, stores fake credentials through SetSecret,
// starts a run and prints every status event. scripts/e2e.sh runs it against dry-run vendors.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	connect "connectrpc.com/connect"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
	mcpstudiov1connect "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1/mcpstudiov1connect"
)

// the same shape the canvas saves: react flow nodes (+ a config map) and edges (+ the frozen shape-adapter mapping)
const graph = `{
  "nodes": [
    {"id":"n-yt","type":"pipelineNode","position":{"x":0,"y":0},"data":{"manifestId":"youtube-download"},"config":{"url":%q,"max_minutes":"1"}},
    {"id":"n-conv","type":"pipelineNode","position":{"x":300,"y":0},"data":{"manifestId":"format-converter","hop":{"from":"video/mp4","to":"audio/mpeg"}},"config":{}},
    {"id":"n-groq","type":"pipelineNode","position":{"x":600,"y":0},"data":{"manifestId":"groq-transcribe"},"config":{"model":"whisper-large-v3-turbo"}},
    {"id":"n-gem","type":"pipelineNode","position":{"x":900,"y":0},"data":{"manifestId":%q},"config":{"model":"gemini-3.5-flash-lite","style":"lecture notes","num_questions":"2"}},
    {"id":"n-mail","type":"pipelineNode","position":{"x":1200,"y":0},"data":{"manifestId":"email-send"},"config":{"from_address":"me@example.com","to_address":"you@example.com"}}
  ],
  "edges": [
    {"id":"e1","source":"n-yt","sourceHandle":"video_out","target":"n-conv","targetHandle":"media_in"},
    {"id":"e2","source":"n-conv","sourceHandle":"media_out","target":"n-groq","targetHandle":"audio_in"},
    {"id":"e3","source":"n-groq","sourceHandle":"transcript","target":"n-gem","targetHandle":"transcript_in","type":"shapeAdapter",
     "data":{"mapping":[{"from":"text","to":"text"},{"from":"language","to":"language"}]}},
    {"id":"e4","source":"n-gem","sourceHandle":"email_out","target":"n-mail","targetHandle":"email_in"}
  ]
}`

func main() {
	base := flag.String("addr", "http://127.0.0.1:8787", "orchestrator address")
	video := flag.String("video", "", "local video file to use as the source")
	quiz := flag.Bool("quiz", false, "use the quiz node instead of the notes node")
	flag.Parse()
	if *video == "" {
		log.Fatal("-video is required")
	}

	middle := "gemini-notes"
	if *quiz {
		middle = "gemini-quiz"
	}

	ctx := context.Background()
	c := mcpstudiov1connect.NewOrchestratorClient(http.DefaultClient, *base)

	for _, s := range []struct{ node, field string }{{"n-groq", "groq_api_key"}, {"n-gem", "gemini_api_key"}, {"n-mail", "gmail_app_password"}} {
		_, err := c.SetSecret(ctx, connect.NewRequest(&mcpstudiov1.SetSecretRequest{NodeId: s.node, Field: s.field, Value: "fake-" + s.field}))
		check(err, "SetSecret "+s.field)
	}

	_, err := c.SavePipeline(ctx, connect.NewRequest(&mcpstudiov1.SavePipelineRequest{
		Pipeline: &mcpstudiov1.Pipeline{Id: "e2e", GraphJson: fmt.Sprintf(graph, *video, middle)},
	}))
	check(err, "SavePipeline")

	start, err := c.StartRun(ctx, connect.NewRequest(&mcpstudiov1.StartRunRequest{PipelineId: "e2e"}))
	check(err, "StartRun")

	stream, err := c.WatchRun(ctx, connect.NewRequest(&mcpstudiov1.WatchRunRequest{RunId: start.Msg.RunId}))
	check(err, "WatchRun")
	verdict := ""
	for stream.Receive() {
		ev := stream.Msg()
		who := ev.NodeId
		if who == "" {
			who, verdict = "RUN", ev.Status
		}
		fmt.Printf("%-8s %-10s %s\n", who, ev.Status, ev.Detail)
	}
	check(stream.Err(), "stream")
	if verdict != "succeeded" {
		os.Exit(1)
	}
	fmt.Println("e2e: OK")
}

func check(err error, what string) {
	if err != nil {
		log.Fatalf("%s: %v", what, err)
	}
}
