"""email-send: {subject, body} in, one email out, over gmail smtp with an app password."""

import smtplib
from email.message import EmailMessage

from common import DRY_RUN, Ctx, NodeError

HOST, PORT = "smtp.gmail.com", 587


def run(ctx: Ctx):
    mail = ctx.input_json("email_in")
    sender = ctx.config.get("from_address", "").strip()
    to = [a.strip() for a in ctx.config.get("to_address", "").split(",") if a.strip()]
    if not sender or not to:
        raise NodeError("from_address and to_address are both required")

    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, ", ".join(to), str(mail.get("subject", "(no subject)"))
    msg.set_content(str(mail.get("body", "")))

    if DRY_RUN:  # write the email to disk instead of sending it
        path = ctx.dir / "email.eml"
        path.write_bytes(bytes(msg))
        return {}, f"DRY RUN: would send '{msg['Subject']}' to {msg['To']} (saved {path.name})"

    password = ctx.config.get("gmail_app_password", "").replace(" ", "")  # google shows it in 4 groups
    if not password:
        raise NodeError("gmail_app_password is not set")

    try:
        with smtplib.SMTP(HOST, PORT, timeout=60) as smtp:
            smtp.starttls()
            smtp.login(sender, password)
            smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        raise NodeError("gmail rejected the login. Use an app password (needs 2-step verification), not your normal password")
    except (smtplib.SMTPException, OSError) as e:
        raise NodeError(f"could not send the email: {type(e).__name__}")
    return {}, f"sent '{msg['Subject']}' to {msg['To']}"
