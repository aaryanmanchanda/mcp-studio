// Package main implements the Go side of the Phase 1 cross-language proof:
// dial the throwaway Python Runner stub, call ExecuteNode, and turn
// "received a SUCCEEDED acknowledgement" into this process's exit code.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:50051", "address of the Runner stub")
	flag.Parse()

	conn, err := grpc.NewClient(*addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("dial %s: %v", *addr, err)
	}
	defer conn.Close()

	client := mcpstudiov1.NewRunnerClient(conn)

	stream, err := client.ExecuteNode(context.Background(), &mcpstudiov1.ExecuteNodeRequest{
		NodeId: "roundtrip-probe",
	})
	if err != nil {
		log.Fatalf("ExecuteNode call: %v", err)
	}

	sawSucceeded := false
	for {
		event, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Fatalf("stream recv: %v", err)
		}
		fmt.Printf("node_id=%s status=%s\n", event.GetNodeId(), event.GetStatus())
		if event.GetStatus() == mcpstudiov1.NodeEvent_STATUS_SUCCEEDED {
			sawSucceeded = true
		}
	}

	if !sawSucceeded {
		fmt.Fprintln(os.Stderr, "roundtrip: no SUCCEEDED NodeEvent observed")
		os.Exit(1)
	}
	fmt.Println("roundtrip: OK")
}
