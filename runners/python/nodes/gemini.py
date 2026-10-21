"""gemini-notes: transcript in, a ready-to-send {subject, body} email out."""

from common import DRY_RUN, Ctx, NodeError, json_out
from nodes.gemini_client import MAX_CHARS, generate_json

STYLES = {
    "lecture notes": "Write clear lecture notes: a one-paragraph overview, then the key concepts as short bullet points, then 3 things to remember.",
    "executive summary": "Write a concise executive summary: the main point, 4-6 supporting points, and any decisions or actions mentioned.",
    "study questions": "Write a short summary, then 8 study questions (with one-line answers) a student could use to revise this material.",
}

SCHEMA = {
    "type": "OBJECT",
    "properties": {"subject": {"type": "STRING"}, "body": {"type": "STRING"}},
    "required": ["subject", "body"],
}


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

    prompt = (
        f"{STYLES.get(style, STYLES['lecture notes'])}\n"
        "The result is the body of an email, so use plain text only: no markdown symbols like ** or #. "
        "Also write a short, specific email subject line.\n\nTRANSCRIPT:\n" + text[:MAX_CHARS]
    )
    result, note = generate_json(ctx.config, prompt, SCHEMA)
    try:
        subject, body = str(result["subject"]).strip(), str(result["body"]).strip()
    except KeyError:
        raise NodeError("gemini replied without a subject and body. Try again")
    return {"email_out": json_out({"subject": subject, "body": body})}, f"{subject}: {body[:100]}{note}"
