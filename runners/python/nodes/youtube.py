"""youtube-download: url in config, an mp4 on disk out. A local file path works too (demo-day fallback)."""

import shutil
import subprocess
import sys
from pathlib import Path

from common import Ctx, NodeError, blob_out


def run(ctx: Ctx):
    url = ctx.config.get("url", "").strip()
    if not url:
        raise NodeError("url is required: a YouTube link, or a path to a video file on this machine")

    out = ctx.dir / "video.mp4"

    local = Path(url).expanduser()
    if local.is_file():  # skip the network entirely, handy when conference wifi misbehaves
        shutil.copyfile(local, out)
        return {"video_out": blob_out(out, "video/mp4")}, f"using local file {local.name}"

    minutes = float(ctx.config.get("max_minutes") or 10)  # cap the length so a live demo stays quick
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--no-playlist", "--no-progress", "--quiet", "--no-warnings",
        # small mp4 is plenty for a transcript, and downloads in seconds
        "-f", "bv*[height<=360][ext=mp4]+ba[ext=m4a]/b[height<=360][ext=mp4]/b[height<=360]/b",
        "--merge-output-format", "mp4",
        "-o", str(ctx.dir / "video.%(ext)s"),
    ]
    if minutes > 0:
        cmd += ["--download-sections", f"*0-{int(minutes * 60)}"]
    cmd.append(url)

    done = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if done.returncode != 0 or not out.is_file():
        reason = (done.stderr.strip().splitlines() or ["unknown error"])[-1]
        raise NodeError(f"yt-dlp could not download that video: {reason[:200]}")
    return {"video_out": blob_out(out, "video/mp4")}, f"downloaded {out.stat().st_size // 1024} KB (first {minutes:g} min)"
