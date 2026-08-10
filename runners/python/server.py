"""Throwaway Runner service: acknowledges any ExecuteNode request with a
single SUCCEEDED NodeEvent. No real node logic — this exists purely to prove
the generated Go<->Python gRPC contract works end to end (D-04)."""

import sys
from concurrent import futures
from pathlib import Path

import grpc

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "gen" / "python"))

from mcpstudio.v1 import runner_pb2, runner_pb2_grpc  # noqa: E402

ADDRESS = "127.0.0.1:50051"


class RunnerServicer(runner_pb2_grpc.RunnerServicer):
    def ExecuteNode(self, request, context):
        yield runner_pb2.NodeEvent(
            node_id=request.node_id,
            status=runner_pb2.NodeEvent.STATUS_SUCCEEDED,
        )


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    runner_pb2_grpc.add_RunnerServicer_to_server(RunnerServicer(), server)
    server.add_insecure_port(ADDRESS)
    server.start()
    print(f"Runner stub listening on {ADDRESS}")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
