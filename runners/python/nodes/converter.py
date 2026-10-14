"""format-converter: one ffmpeg call that covers every conversion the BFS can chain.
the canvas stamps the exact hop (from -> to) on the node, so we only need the target type here."""

import subprocess

from common import Ctx, NodeError, blob_out, need_binary

EXT = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}


def run(ctx: Ctx):
    src = ctx.input_blob("media_in")
    to = ctx.config.get("hop_to", "")
    ext = EXT.get(to)
    if not ext:
        raise NodeError(f"don't know how to produce '{to}' (hop_to missing or unsupported)")

    ffmpeg = need_binary("ffmpeg", "Install it with: brew install ffmpeg")
    out = ctx.dir / f"converted.{ext}"
    cmd = [ffmpeg, "-y", "-loglevel", "error", "-i", str(src)]
    if to.startswith("audio/"):
        # mono 16 kHz at 48 kbps: speech stays clear, and an hour is ~21 MB, under groq's 25 MB upload cap
        cmd += ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k"]
    cmd.append(str(out))

    done = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if done.returncode != 0 or not out.is_file():
        reason = (done.stderr.strip().splitlines() or ["unknown error"])[-1]
        raise NodeError(f"ffmpeg failed: {reason[:200]}")
    return {"media_out": blob_out(out, to)}, f"{src.suffix.lstrip('.')} -> {ext}, {out.stat().st_size // 1024} KB"
