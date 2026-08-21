package main

import (
	"context"
	"flag"
	"log"
	"net/http"

	connect "connectrpc.com/connect"
	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
	mcpstudiov1connect "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1/mcpstudiov1connect"
)

type manifestServer struct {
	mcpstudiov1connect.UnimplementedOrchestratorHandler
}

func (s *manifestServer) ListNodeManifests(ctx context.Context, req *connect.Request[mcpstudiov1.ListNodeManifestsRequest]) (*connect.Response[mcpstudiov1.ListNodeManifestsResponse], error) {
	resp := &mcpstudiov1.ListNodeManifestsResponse{
		Manifests: fixtureManifests(),
	}
	return connect.NewResponse(resp), nil
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "address for server to listen on")
	flag.Parse()

	mux := http.NewServeMux()
	path, handler := mcpstudiov1connect.NewOrchestratorHandler(&manifestServer{})
	mux.Handle(path, handler)

	log.Printf("listening on %s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
