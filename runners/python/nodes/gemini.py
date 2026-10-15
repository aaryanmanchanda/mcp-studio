"""gemini-notes: transcript in, a ready-to-send {subject, body} email out."""

import json

import requests

from common import DRY_RUN, Ctx, NodeError, json_out

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
DEFAULT_MODEL = "gemini-3.5-flash-lite"  # google retires model names every few months, see _pick_available for the safety net
MAX_CHARS = 400_000  # flash-lite reads ~1M tokens, this keeps a runaway transcript from costing real money

STYLES = {
    "lecture notes": "Write clear lecture notes: a one-paragraph overview, then the key concepts as short bullet points, then 3 things to remember.",
    "executive summary": "Write a concise executive summary: the main point, 4-6 supporting points, and any decisions or actions mentioned.",
    "study questions": "Write a short summary, then 8 study questions (with one-line answers) a student could use to revise this material.",
}


def _pick_available(key):
    """The configured model 404'd (retired or renamed). Ask google what this key can actually use and take the
    newest stable flash-lite, else the newest stable flash. Returns a model id or None."""
    resp = requests.get(LIST_URL, headers={"x-goog-api-key": key}, timeout=60)
    if not resp.ok:
        return None
    names = []
    for m in resp.json().get("models", []):
        name = m.get("name", "").removeprefix("models/")
        if "generateContent" not in m.get("supportedGenerationMethods", []) or not name.startswith("gemini-"):
            continue
        if any(bad in name for bad in ("preview", "image", "tts", "live", "audio", "embedding", "robotics", "thinking", "exp")):
            continue
        names.append(name)
    for family in ("flash-lite", "flash"):
        picks = sorted((n for n in names if family in n and (family == "flash-lite" or "lite" not in n)), reverse=True)
        if picks:
            return picks[0]
    return None


def run(ctx: Ctx):
    transcript = ctx.input_json("transcript_in")
    text = str(transcript.get("text", "")).strip()
    if not text:
        raise NodeError("the transcript is empty, nothing to summarise")

    style = ctx.config.get("style") or "lecture notes"

    if DRY_RUN:
        subject = "Lecture notes: distributed systems"
        body = "OVERVIEW\nA walk through consensus, replication and failure detection.\n\n- Consensus keeps replicas agreeing\n- Replication buys availability\n- Failure detectors trade speed for accuracy"
        return {"email_out": json_out({"subject": subject, "body": body})}, "DRY RUN: " + subject

    key = ctx.config.get("gemini_api_key", "")
    if not key:
        raise NodeError("gemini_api_key is not set")
    model = ctx.config.get("model") or DEFAULT_MODEL

    prompt = (
        f"{STYLES.get(style, STYLES['lecture notes'])}\n"
        "The result is the body of an email, so use plain text only: no markdown symbols like ** or #. "
        "Also write a short, specific email subject line.\n\nTRANSCRIPT:\n" + text[:MAX_CHARS]
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {"subject": {"type": "STRING"}, "body": {"type": "STRING"}},
                "required": ["subject", "body"],
            },
        },
    }
    resp = requests.post(URL.format(model=model), headers={"x-goog-api-key": key}, json=payload, timeout=180)
    note = ""
    if resp.status_code == 404:  # the model name is gone: heal instead of failing the whole demo
        alt = _pick_available(key)
        if alt and alt != model:
            resp = requests.post(URL.format(model=alt), headers={"x-goog-api-key": key}, json=payload, timeout=180)
            note = f" (model '{model}' is gone, used '{alt}')"
            model = alt

    if resp.status_code in (400, 403) and "API key" in resp.text:
        raise NodeError("gemini rejected the API key. Re-enter it in the config panel")
    if resp.status_code == 404:
        raise NodeError(f"gemini doesn't know the model '{model}' and no replacement was found for this key. Pick another in the config panel")
    if resp.status_code == 429:
        raise NodeError("gemini rate limit hit (429). Wait a minute and run again")
    if not resp.ok:
        raise NodeError(f"gemini error {resp.status_code}: {resp.text[:200]}")

    try:
        raw = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        result = json.loads(raw)
        subject, body = str(result["subject"]).strip(), str(result["body"]).strip()
    except (KeyError, IndexError, ValueError):
        raise NodeError("gemini replied in a shape we couldn't read (blocked or empty). Try again")
    return {"email_out": json_out({"subject": subject, "body": body})}, f"{subject}: {body[:100]}{note}"
