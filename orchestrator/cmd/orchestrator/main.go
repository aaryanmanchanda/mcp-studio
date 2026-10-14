// the orchestrator: serves the canvas (connect-rpc), stores pipelines + vault-encrypted credentials in postgres,
// and runs pipelines by calling the python runner (grpc) one node at a time.
// with no DATABASE_URL it still serves the node registry, so scripts/manifests.sh keeps working.
package main

import (
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"

	connect "connectrpc.com/connect"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	mcpstudiov1 "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1"
	mcpstudiov1connect "github.com/mcpstudio/mcp_studio/gen/go/mcpstudio/v1/mcpstudiov1connect"
	"github.com/mcpstudio/mcp_studio/orchestrator/internal/exec"
	"github.com/mcpstudio/mcp_studio/orchestrator/internal/registry"
	"github.com/mcpstudio/mcp_studio/orchestrator/internal/store"
)

type server struct {
	mcpstudiov1connect.UnimplementedOrchestratorHandler
	store *store.Store  // nil when no database is configured
	runs  *exec.Manager // nil when no database is configured
}

var errNoDB = connect.NewError(connect.CodeUnavailable, errors.New("no database configured, set DATABASE_URL and MCPSTUDIO_MASTER_KEY"))

func (s *server) ListNodeManifests(ctx context.Context, req *connect.Request[mcpstudiov1.ListNodeManifestsRequest]) (*connect.Response[mcpstudiov1.ListNodeManifestsResponse], error) {
	return connect.NewResponse(&mcpstudiov1.ListNodeManifestsResponse{Manifests: registry.Manifests()}), nil
}

func (s *server) SavePipeline(ctx context.Context, req *connect.Request[mcpstudiov1.SavePipelineRequest]) (*connect.Response[mcpstudiov1.SavePipelineResponse], error) {
	if s.store == nil {
		return nil, errNoDB
	}
	p := req.Msg.GetPipeline()
	if p.GetId() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("pipeline id is required"))
	}
	if err := s.store.SavePipeline(ctx, p.Id, p.GraphJson); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&mcpstudiov1.SavePipelineResponse{Id: p.Id}), nil
}

func (s *server) GetPipeline(ctx context.Context, req *connect.Request[mcpstudiov1.GetPipelineRequest]) (*connect.Response[mcpstudiov1.GetPipelineResponse], error) {
	if s.store == nil {
		return nil, errNoDB
	}
	graph, err := s.store.GetPipeline(ctx, req.Msg.Id)
	if errors.Is(err, store.ErrNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, err) // the canvas treats this as "nothing saved yet"
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&mcpstudiov1.GetPipelineResponse{Pipeline: &mcpstudiov1.Pipeline{Id: req.Msg.Id, GraphJson: graph}}), nil
}

func (s *server) StartRun(ctx context.Context, req *connect.Request[mcpstudiov1.StartRunRequest]) (*connect.Response[mcpstudiov1.StartRunResponse], error) {
	if s.store == nil {
		return nil, errNoDB
	}
	graph, err := s.store.GetPipeline(ctx, req.Msg.PipelineId)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	runID, err := s.runs.Start(graph)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err) // validation message goes straight to the user
	}
	return connect.NewResponse(&mcpstudiov1.StartRunResponse{RunId: runID}), nil
}

func (s *server) WatchRun(ctx context.Context, req *connect.Request[mcpstudiov1.WatchRunRequest], stream *connect.ServerStream[mcpstudiov1.RunEvent]) error {
	if s.store == nil {
		return errNoDB
	}
	return s.runs.Watch(ctx, req.Msg.RunId, stream.Send)
}

func (s *server) SetSecret(ctx context.Context, req *connect.Request[mcpstudiov1.SetSecretRequest]) (*connect.Response[mcpstudiov1.SetSecretResponse], error) {
	if s.store == nil {
		return nil, errNoDB
	}
	m := req.Msg
	if m.NodeId == "" || m.Field == "" || m.Value == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("node_id, field and value are required"))
	}
	// the value is never logged and never echoed back, the response only says it's stored
	if err := s.store.SetSecret(ctx, m.NodeId, m.Field, m.Value); err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("could not store the credential"))
	}
	return connect.NewResponse(&mcpstudiov1.SetSecretResponse{Configured: true}), nil
}

func (s *server) ListSecretStatus(ctx context.Context, req *connect.Request[mcpstudiov1.ListSecretStatusRequest]) (*connect.Response[mcpstudiov1.ListSecretStatusResponse], error) {
	if s.store == nil {
		return connect.NewResponse(&mcpstudiov1.ListSecretStatusResponse{}), nil // no db means nothing is configured, not an error
	}
	refs, err := s.store.ListSecretStatus(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	resp := &mcpstudiov1.ListSecretStatusResponse{}
	for _, r := range refs {
		resp.Configured = append(resp.Configured, &mcpstudiov1.SecretStatus{NodeId: r.NodeID, Field: r.Field})
	}
	return connect.NewResponse(resp), nil
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "address for the canvas to talk to")
	runnerAddr := flag.String("runner", "127.0.0.1:50051", "address of the python runner")
	dbURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "postgres connection string")
	flag.Parse()

	srv := &server{}
	if *dbURL != "" {
		// the vault master key comes from the environment, never from a flag (flags show up in `ps`)
		key, err := base64.StdEncoding.DecodeString(os.Getenv("MCPSTUDIO_MASTER_KEY"))
		if err != nil || len(key) != 32 {
			log.Fatal("MCPSTUDIO_MASTER_KEY must be 32 bytes, base64 encoded. make one with: openssl rand -base64 32")
		}
		st, err := store.Open(context.Background(), *dbURL, key)
		if err != nil {
			log.Fatalf("database: %v", err)
		}
		defer st.Close()

		conn, err := grpc.NewClient(*runnerAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
		if err != nil {
			log.Fatalf("runner dial: %v", err)
		}
		defer conn.Close()

		srv.store = st
		srv.runs = exec.NewManager(exec.GRPCRunner{Client: mcpstudiov1.NewRunnerClient(conn)}, st, registry.ByID())
	} else {
		log.Print("no DATABASE_URL: serving the node registry only (no pipelines, secrets or runs)")
	}

	mux := http.NewServeMux()
	path, handler := mcpstudiov1connect.NewOrchestratorHandler(srv)
	mux.Handle(path, handler)

	log.Printf("listening on %s", *addr)
	log.Fatal((&http.Server{Addr: *addr, Handler: mux}).ListenAndServe()) // no write timeout, watchRun streams for minutes
}
