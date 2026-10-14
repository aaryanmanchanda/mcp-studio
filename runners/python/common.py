"""Shared plumbing every node uses: the per-call context, NodeIO helpers, and the one error type.

Nothing in this package may log or return a config value. The orchestrator hands us decrypted
credentials inside request.config for exactly one call, so we treat the whole dict as radioactive."""

import os
import shutil
from pathlib import Path
from urllib.parse import unquote, urlparse

from google.protobuf.struct_pb2 import Struct
from mcpstudio.v1 import nodeio_pb2

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("MCPSTUDIO_DATA_DIR", REPO_ROOT / "data" / "artifacts"))

# dry run fakes only the paid vendor calls (groq, gemini, smtp) so the whole pipeline can be rehearsed offline
DRY_RUN = os.environ.get("MCPSTUDIO_DRY_RUN") == "1"


class NodeError(Exception):
    """A failure the user can act on. The message is shown in the UI, so keep it plain and secret-free."""


class Ctx:
    """Everything one node call needs: config, wired-in inputs, and a scratch dir for its files."""

    def __init__(self, request):
        self.config = dict(request.config)
        self.inputs = request.inputs
        self.dir = DATA_DIR / (request.run_id or "adhoc") / request.node_id  # artifacts grouped per run, per node
        self.dir.mkdir(parents=True, exist_ok=True)

    def input_blob(self, name):
        io = self.inputs.get(name)
        if io is None or not io.HasField("blob_ref"):
            raise NodeError(f"input '{name}' has no file attached")
        path = path_from_uri(io.blob_ref.uri)
        if not path.is_file():
            raise NodeError(f"input '{name}' points at a file that is gone")
        return path

    def input_json(self, name):
        io = self.inputs.get(name)
        if io is None or not io.HasField("json_value"):
            raise NodeError(f"input '{name}' has no data attached")
        return dict(io.json_value)


def blob_out(path, content_type):
    # a file:// uri today; swapping in s3:// later is the only change the storage layer needs
    return nodeio_pb2.NodeIO(blob_ref=nodeio_pb2.BlobRef(uri=Path(path).resolve().as_uri(), content_type=content_type))


def json_out(data):
    s = Struct()
    s.update(data)
    return nodeio_pb2.NodeIO(json_value=s)


def path_from_uri(uri):
    parsed = urlparse(uri)
    if parsed.scheme in ("", "file"):
        return Path(unquote(parsed.path))
    raise NodeError(f"unsupported storage uri '{parsed.scheme}://'")


def need_binary(name, hint):
    found = shutil.which(name)
    if not found:
        raise NodeError(f"{name} is not installed. {hint}")
    return found


def scrub(message, config):
    """Belt and braces: blank out any secret-looking config value that leaked into an error string."""
    for key, value in config.items():
        if value and (key.endswith("_key") or key.endswith("_password")):
            message = message.replace(value, "***")
    return message
