"""groq-transcribe: audio file in, transcript json out, via groq's openai-compatible whisper endpoint."""

import requests

from common import DRY_RUN, Ctx, NodeError, json_out

URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MAX_BYTES = 24 * 1024 * 1024  # groq's free tier caps uploads at 25 MB


def run(ctx: Ctx):
    path = ctx.input_blob("audio_in")
    size = path.stat().st_size
    if size > MAX_BYTES:
        raise NodeError(f"audio is {size // (1024 * 1024)} MB, over groq's 25 MB limit. Lower max_minutes on the download node")

    if DRY_RUN:
        text = "Welcome to today's lecture on distributed systems. We cover consensus, replication and failure detection."
        return {"transcript": json_out({"text": text, "language": "en", "duration_sec": 42.0})}, "DRY RUN: " + text[:120]

    key = ctx.config.get("groq_api_key", "")
    if not key:
        raise NodeError("groq_api_key is not set")
    data = {"model": ctx.config.get("model") or "whisper-large-v3-turbo", "response_format": "verbose_json"}
    if ctx.config.get("language", "").strip():
        data["language"] = ctx.config["language"].strip()

    with open(path, "rb") as f:
        resp = requests.post(URL, headers={"Authorization": f"Bearer {key}"}, files={"file": (path.name, f, "audio/mpeg")}, data=data, timeout=300)

    if resp.status_code == 401:
        raise NodeError("groq rejected the API key (401). Re-enter it in the config panel")
    if resp.status_code == 429:
        raise NodeError("groq rate limit hit (429). Wait a minute and run again")
    if not resp.ok:
        raise NodeError(f"groq error {resp.status_code}: {resp.text[:200]}")

    body = resp.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise NodeError("groq returned an empty transcript (is there speech in the audio?)")
    out = {"text": text, "language": body.get("language") or "", "duration_sec": float(body.get("duration") or 0)}
    return {"transcript": json_out(out)}, f"{len(text)} characters: {text[:120]}"
