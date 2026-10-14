package exec

import (
	"context"
	"io"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
)

// GRPCRunner is the real NodeRunner: it calls the python runner over the generated contract
type GRPCRunner struct {
	Client mcpstudiov1.RunnerClient
}

func (g GRPCRunner) Run(ctx context.Context, req *mcpstudiov1.ExecuteNodeRequest, emit func(*mcpstudiov1.NodeEvent)) error {
	stream, err := g.Client.ExecuteNode(ctx, req)
	if err != nil {
		return err
	}
	for {
		ev, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		emit(ev)
	}
}
