#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"


ADDRESS_HOST="127.0.0.1"
ADDRESS_PORT="8080"

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
# clean up on exit

echo "starting manifest server..."
BIN="$(mktemp -d)/manifestserver"
go build -o "$BIN" ./orchestrator/cmd/manifestserver/

"$BIN" -addr "${ADDRESS_HOST}:${ADDRESS_PORT}" &
SERVER_PID=$!

# wait until server actually accepting connections
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

echo "querying ListNodeManifests..."
#HTTP call to get current manifests
RESPONSE=$(curl -s -X POST "http://${ADDRESS_HOST}:${ADDRESS_PORT}/mcpstudio.v1.Orchestrator/ListNodeManifests" \
  -H "Content-Type: application/json" -d '{}')

MANIFEST_COUNT=$(echo "$RESPONSE" | jq '.manifests | length')
CATEGORY_COUNT=$(echo "$RESPONSE" | jq '[.manifests[].category] | unique | length')


if [ "$MANIFEST_COUNT" -eq 6 ] && [ "$CATEGORY_COUNT" -eq 4 ]; then
  echo "OK: ${MANIFEST_COUNT} manifests across ${CATEGORY_COUNT} categories"
  exit 0
else
  echo "FAILED: expected 6 manifests / 4 categories, got ${MANIFEST_COUNT} / ${CATEGORY_COUNT}" >&2
  exit 1
fi
