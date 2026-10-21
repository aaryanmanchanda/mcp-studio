"""gemini-quiz: transcript in, a quiz as a ready-to-send {subject, body} email out.
asks gemini for structured questions, then lays the email out ourselves so the format is identical every run."""

from common import DRY_RUN, Ctx, NodeError, json_out
from nodes.gemini_client import MAX_CHARS, generate_json

KINDS = {
    "multiple choice": "Each question is multiple choice with exactly 4 options, exactly one correct.",
    "true/false": "Each question is a true/false statement. Use options [\"True\", \"False\"].",
    "short answer": "Each question is answered in a sentence or two. Leave options empty.",
}

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": {"type": "STRING"},
        "questions": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "question": {"type": "STRING"},
                    "options": {"type": "ARRAY", "items": {"type": "STRING"}},
                    "answer": {"type": "STRING"},  # the correct option's text, or the model answer for short answer
                    "why": {"type": "STRING"},
                },
                "required": ["question", "options", "answer", "why"],
            },
        },
    },
    "required": ["title", "questions"],
}


def format_quiz(title, questions, include_answers=True):
    """Plain-text email body. Pure function so it can be tested without any network."""
    lines = [title, ""]
    for i, q in enumerate(questions, 1):
        lines.append(f"{i}. {q['question']}")
        for letter, option in zip("ABCDEFGH", q.get("options") or []):
            lines.append(f"   {letter}) {option}")
        lines.append("")
    if include_answers:
        lines += ["ANSWER KEY", ""]
        for i, q in enumerate(questions, 1):
            options = q.get("options") or []
            answer = q["answer"]
            if answer in options:  # show the letter too, it's what a student will look for
                answer = f"{'ABCDEFGH'[options.index(answer)]}) {answer}"
            lines.append(f"{i}. {answer}")
            if q.get("why"):
                lines.append(f"   {q['why']}")
    return "\n".join(lines).rstrip() + "\n"


def run(ctx: Ctx):
    transcript = ctx.input_json("transcript_in")
    text = str(transcript.get("text", "")).strip()
    if not text:
        raise NodeError("the transcript is empty, nothing to make a quiz from")

    try:
        count = int(float(ctx.config.get("num_questions") or 8))
    except ValueError:
        raise NodeError("num_questions must be a number")
    count = max(1, min(count, 30))
    kind = ctx.config.get("question_type") or "multiple choice"
    difficulty = ctx.config.get("difficulty") or "medium"
    include_answers = (ctx.config.get("answer_key") or "include") == "include"

    if DRY_RUN:
        questions = [
            {"question": "What does consensus let replicas do?", "options": ["Agree on a value", "Compress data", "Encrypt traffic", "Cache pages"],
             "answer": "Agree on a value", "why": "Consensus protocols make replicas agree despite failures."},
            {"question": "Replication mainly buys...", "options": ["Availability", "Smaller disks", "Faster CPUs", "Lower latency always"],
             "answer": "Availability", "why": "Copies keep the service up when one node dies."},
        ][:count]
        body = format_quiz("Quiz: distributed systems", questions, include_answers)
        return {"email_out": json_out({"subject": "Quiz: distributed systems", "body": body})}, f"DRY RUN: {len(questions)} questions"

    prompt = (
        f"Write a {difficulty}-difficulty quiz of exactly {count} questions based ONLY on the transcript below. "
        f"{KINDS.get(kind, KINDS['multiple choice'])} "
        "Cover the material evenly, do not ask about anything the transcript does not say, and keep wording plain text (no markdown). "
        "Give the quiz a short title, and for each question the correct answer and a one-sentence reason.\n\nTRANSCRIPT:\n" + text[:MAX_CHARS]
    )
    result, note = generate_json(ctx.config, prompt, SCHEMA)

    questions = [q for q in result.get("questions", []) if q.get("question") and q.get("answer")]
    if not questions:
        raise NodeError("gemini returned no usable questions. Try again, or use a longer transcript")
    title = str(result.get("title") or "Quiz").strip()
    body = format_quiz(title, questions, include_answers)
    return {"email_out": json_out({"subject": f"Quiz: {title}", "body": body})}, f"{len(questions)} questions on '{title}'{note}"
