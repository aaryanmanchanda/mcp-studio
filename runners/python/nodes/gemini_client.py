"""The one place that talks to gemini. gemini-notes and gemini-quiz both go through generate_json."""

import json

import requests

from common import NodeError

URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
LIST_URL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
DEFAULT_MODEL = "gemini-3.5-flash-lite"  # google retires model names every few months, see _pick_available for the safety net
MAX_CHARS = 400_000  # flash-lite reads ~1M tokens, this keeps a runaway transcript from costing real money


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


def generate_json(config, prompt, schema):
    """Send one prompt, get back (parsed_json, note). `note` says so if the configured model had to be swapped."""
    key = config.get("gemini_api_key", "")
    if not key:
        raise NodeError("gemini_api_key is not set")
    model = config.get("model") or DEFAULT_MODEL

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": schema},
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
        return json.loads(raw), note
    except (KeyError, IndexError, ValueError):
        raise NodeError("gemini replied in a shape we couldn't read (blocked or empty). Try again")
