#!/usr/bin/env bash
# Starts the throwaway Python Runner stub, runs the Go round-trip client
# against it, and exits with the client's exit code. This one command is
# ROADMAP success criterion 3: proof that the Go orchestrator and Python
# runner talk over the generated gRPC contract.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PY_VENV="runners/python/.venv/bin/python"
ADDRESS_HOST="127.0.0.1"
ADDRESS_PORT="50051"

if [ ! -x "$PY_VENV" ]; then
  echo "Python venv not found. Run:" >&2
  echo "  python3 -m venv runners/python/.venv && runners/python/.venv/bin/pip install -r runners/python/requirements.txt" >&2
  exit 1
fi

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "starting Python Runner stub..."
"$PY_VENV" runners/python/server.py &
SERVER_PID=$!

echo "waiting for ${ADDRESS_HOST}:${ADDRESS_PORT}..."
CONNECTED=false
for _ in $(seq 1 50); do
  if (exec 3<>"/dev/tcp/${ADDRESS_HOST}/${ADDRESS_PORT}") 2>/dev/null; then
    exec 3>&- 3<&-
    CONNECTED=true
    break
  fi
  sleep 0.1
done

if [ "$CONNECTED" != true ]; then
  echo "server did not start listening within 5s" >&2
  exit 1
fi

echo "running Go round-trip client..."
set +e
go run ./orchestrator/cmd/roundtrip/
CLIENT_EXIT=$?
set -e

exit "$CLIENT_EXIT"
