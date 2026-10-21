"""The python runner: the orchestrator hands it one node at a time over grpc, it does the work and streams events back.

Adding a node = one file in nodes/ with a run(ctx) function, plus one line in NODES below.
Vendors are called directly for now (MCP wrapping is a later step), each behind its own small module."""

import logging
import sys
from concurrent import futures
from pathlib import Path

import grpc

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "gen" / "python"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcpstudio.v1 import runner_pb2, runner_pb2_grpc  # noqa: E402

from common import Ctx, NodeError, scrub  # noqa: E402
from nodes import converter, email_send, gemini, groq, quiz, youtube  # noqa: E402

ADDRESS = "127.0.0.1:50051"

# manifest id -> the function that runs it
NODES = {
    "youtube-download": youtube.run,
    "format-converter": converter.run,
    "groq-transcribe": groq.run,
    "gemini-notes": gemini.run,
    "gemini-quiz": quiz.run,
    "email-send": email_send.run,
}

Event = runner_pb2.NodeEvent
log = logging.getLogger("runner")


class RunnerServicer(runner_pb2_grpc.RunnerServicer):
    def ExecuteNode(self, request, context):
        # never log the request itself, request.config carries decrypted credentials
        log.info("node %s (%s)", request.node_id, request.manifest_id)

        if not request.manifest_id:  # the phase 1 round-trip probe sends no manifest, keep acknowledging it
            yield Event(node_id=request.node_id, status=Event.STATUS_SUCCEEDED)
            return

        fn = NODES.get(request.manifest_id)
        if fn is None:
            yield Event(node_id=request.node_id, status=Event.STATUS_FAILED,
                        error=f"'{request.manifest_id}' is a canvas-only node, the runner has no implementation for it yet")
            return

        yield Event(node_id=request.node_id, status=Event.STATUS_RUNNING)
        try:
            outputs, detail = fn(Ctx(request))
            yield Event(node_id=request.node_id, status=Event.STATUS_SUCCEEDED, outputs=outputs, detail=detail)
        except NodeError as e:
            yield Event(node_id=request.node_id, status=Event.STATUS_FAILED, error=scrub(str(e), request.config))
        except Exception as e:  # a bug, not a user mistake: log the type only, tracebacks can echo config values
            log.error("node %s crashed: %s", request.node_id, type(e).__name__)
            yield Event(node_id=request.node_id, status=Event.STATUS_FAILED,
                        error=f"unexpected {type(e).__name__} in {request.manifest_id}, see the runner log")


def serve():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    runner_pb2_grpc.add_RunnerServicer_to_server(RunnerServicer(), server)
    server.add_insecure_port(ADDRESS)
    server.start()
    print(f"Runner listening on {ADDRESS}", flush=True)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
