#!/usr/bin/env bash
# Headless end-to-end rehearsal of the demo pipeline with the paid vendors faked (MCPSTUDIO_DRY_RUN=1).
# Real yt-dlp-free input (a generated test video), real ffmpeg conversion, real postgres + vault,
# real orchestrator <-> runner grpc. Needs docker (for postgres) and ffmpeg.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

docker compose up -d --wait postgres >/dev/null
export DATABASE_URL="postgres://mcpstudio:mcpstudio@127.0.0.1:5433/mcpstudio"
export MCPSTUDIO_MASTER_KEY="$(openssl rand -base64 32)"   # throwaway key, this run's credentials die with it
export MCPSTUDIO_DRY_RUN=1
export MCPSTUDIO_DATA_DIR="$(mktemp -d)"
ADDR="127.0.0.1:8799"

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

VIDEO="$MCPSTUDIO_DATA_DIR/input.mp4"
ffmpeg -y -loglevel error -f lavfi -i testsrc=duration=3:size=320x240:rate=15 -f lavfi -i sine=frequency=440:duration=3 -shortest "$VIDEO"

runners/python/.venv/bin/python runners/python/server.py >/dev/null 2>&1 & PIDS+=($!)
go run ./orchestrator/cmd/orchestrator -addr "$ADDR" >/dev/null 2>&1 & PIDS+=($!)

for _ in $(seq 1 100); do
  (exec 3<>"/dev/tcp/127.0.0.1/8799") 2>/dev/null && break
  sleep 0.2
done
sleep 1
go run ./orchestrator/cmd/e2e -addr "http://$ADDR" -video "$VIDEO"
