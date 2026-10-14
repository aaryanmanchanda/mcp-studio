#!/usr/bin/env bash
# One command to run the whole stack locally: postgres (docker), python runner, go orchestrator, vite frontend.
#   scripts/dev.sh                    real vendors, you enter your own keys in the config panel
#   MCPSTUDIO_DRY_RUN=1 scripts/dev.sh   fakes groq / gemini / gmail so you can rehearse with no keys
# Ctrl+C stops everything except postgres (docker compose down stops that).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# first run: make .env with a fresh vault master key. keep it, losing it makes saved credentials unreadable.
if [ ! -f .env ]; then
  cp .env.example .env
  KEY="$(openssl rand -base64 32)"
  sed -i.bak "s|^MCPSTUDIO_MASTER_KEY=.*|MCPSTUDIO_MASTER_KEY=${KEY}|" .env && rm -f .env.bak
  echo "created .env with a new vault master key (back it up if you care about the stored credentials)"
fi
set -a; . ./.env; set +a

PY="runners/python/.venv/bin/python"
if [ ! -x "$PY" ]; then
  echo "setting up the python runner venv..."
  python3 -m venv runners/python/.venv
  runners/python/.venv/bin/pip install -q -r runners/python/requirements.txt
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is required: brew install ffmpeg" >&2; exit 1; }

docker compose up -d --wait postgres >/dev/null

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

"$PY" runners/python/server.py & PIDS+=($!)
go run ./orchestrator/cmd/orchestrator & PIDS+=($!)
pnpm --filter @mcpstudio/frontend dev & PIDS+=($!)

[ "${MCPSTUDIO_DRY_RUN:-}" = "1" ] && echo ">> DRY RUN: groq, gemini and gmail are faked" || true
echo ">> open http://localhost:5173"
wait
