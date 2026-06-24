"""E-mail service with template + branding support.

All transactional e-mails go through `EmailService.send` which:
* loads the EmailTemplate row from DB by `key`
* injects branding into a branded HTML layout
* uses str.format_map with safe defaults for missing variables
* supports multiple recipients (CSV / list)
"""

import logging
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings
from app.database import SessionLocal
from app.models import EmailBrandingSettings, EmailTemplate

logger = logging.getLogger(__name__)
settings = get_settings()


class _SafeDict(dict):
    """dict subclass that returns the original placeholder for missing keys."""

    def __missing__(self, key):
        return "{" + key + "}"


def _parse_recipients(value) -> list[str]:
    """Normalise CSV / iterable / single string into a deduplicated list."""
    if not value:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,;\s]+", value)
    else:
        try:
            parts = list(value)
        except TypeError:
            parts = [str(value)]
    cleaned: list[str] = []
    seen: set[str] = set()
    for p in parts:
        if not p:
            continue
        addr = str(p).strip()
        if not addr or addr in seen or "@" not in addr:
            continue
        seen.add(addr)
        cleaned.append(addr)
    return cleaned


def _load_branding() -> dict:
    db = SessionLocal()
    try:
        row = db.query(EmailBrandingSettings).first()
        if not row:
            return {
                "brand_name": "OPNsense CMS",
                "logo_url": None,
                "primary_color": "#4f46e5",
                "accent_color": "#3b82f6",
                "footer_text": None,
                "reply_to": None,
            }
        return {
            "brand_name": row.brand_name or "OPNsense CMS",
            "logo_url": row.logo_url,
            "primary_color": row.primary_color or "#4f46e5",
            "accent_color": row.accent_color or "#3b82f6",
            "footer_text": row.footer_text,
            "reply_to": row.reply_to,
        }
    finally:
        db.close()


def _load_template(key: str):
    db = SessionLocal()
    try:
        return db.query(EmailTemplate).filter(EmailTemplate.key == key).first()
    finally:
        db.close()


def _wrap_html(body: str, branding: dict) -> str:
    """Wrap the template body in a branded HTML layout."""
    brand = branding.get("brand_name") or "OPNsense CMS"
    logo = branding.get("logo_url")
    primary = branding.get("primary_color") or "#4f46e5"
    footer = branding.get("footer_text") or "Automated message - please do not reply."

    logo_html = (
        f'<img src="{logo}" alt="{brand}" style="max-height:48px;display:block;">'
        if logo
        else f'<h1 style="margin:0;color:#fff;font-size:20px;">{brand}</h1>'
    )

    return f"""<!DOCTYPE html>
<html><head><meta charset=\"UTF-8\"></head>
<body style=\"margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;\">
  <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"100%\" style=\"background:#f3f4f6;padding:24px 0;\">
    <tr><td align=\"center\">
      <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" width=\"600\" style=\"background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);\">
        <tr><td style=\"background:{primary};padding:20px 24px;color:#fff;\">{logo_html}</td></tr>
        <tr><td style=\"padding:24px;line-height:1.5;font-size:14px;color:#111827;\">{body}</td></tr>
        <tr><td style=\"padding:16px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;text-align:center;\">{footer}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


def _render(template_text: str, context: dict) -> str:
    if not template_text:
        return ""
    try:
        return template_text.format_map(_SafeDict(context))
    except Exception as e:  # noqa: BLE001
        logger.warning(f"Template render failed: {e}")
        return template_text


def _send_smtp(to_emails: list[str], subject: str, html: str, plain: str | None, reply_to: str | None) -> bool:
    if not to_emails:
        logger.info("No recipients - skipping e-mail")
        return False

    preferred_from = settings.SMTP_FROM
    fallback_from = settings.SMTP_USER if settings.SMTP_USER else settings.SMTP_FROM

    def _build_message(from_addr: str) -> str:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr
        msg["To"] = ", ".join(to_emails)
        if reply_to:
            msg["Reply-To"] = reply_to
        if plain:
            msg.attach(MIMEText(plain, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))
        return msg.as_string()

    def _attempt_send(from_addr: str) -> None:
        payload = _build_message(from_addr)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
            if settings.SMTP_USE_TLS:
                server.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(from_addr, to_emails, payload)

    try:
        _attempt_send(preferred_from)
        logger.info(f"Email sent to {to_emails}: {subject}")
        return True
    except smtplib.SMTPRecipientsRefused as e:
        # Some providers report sender-policy violations here (not as SMTPResponseException).
        can_retry = fallback_from and fallback_from != preferred_from
        if can_retry:
            try:
                logger.warning(
                    "SMTP recipients refused with sender '%s'. Retrying with authenticated sender '%s'. Details: %s",
                    preferred_from,
                    fallback_from,
                    e.recipients,
                )
                _attempt_send(fallback_from)
                logger.info(f"Email sent to {to_emails}: {subject}")
                return True
            except Exception as retry_error:  # noqa: BLE001
                logger.error(f"Failed to send email to {to_emails}: {retry_error}")
                return False
        logger.error(f"Failed to send email to {to_emails}: {e.recipients}")
        return False
    except smtplib.SMTPResponseException as e:
        # Common with hosted SMTP providers: sender must match authenticated user.
        can_retry = fallback_from and fallback_from != preferred_from and e.smtp_code in {550, 553, 554}
        if can_retry:
            try:
                logger.warning(
                    "SMTP sender rejected for '%s' (code %s). Retrying with authenticated sender '%s'.",
                    preferred_from,
                    e.smtp_code,
                    fallback_from,
                )
                _attempt_send(fallback_from)
                logger.info(f"Email sent to {to_emails}: {subject}")
                return True
            except Exception as retry_error:  # noqa: BLE001
                logger.error(f"Failed to send email to {to_emails}: {retry_error}")
                return False
        logger.error(f"Failed to send email to {to_emails}: {e}")
        return False
    except Exception as e:  # noqa: BLE001
        logger.error(f"Failed to send email to {to_emails}: {e}")
        return False


class EmailService:
    """High-level interface used by the rest of the application."""

    @staticmethod
    def render(template_key: str, context: dict | None = None) -> dict:
        tpl = _load_template(template_key)
        branding = _load_branding()
        ctx = {**branding, **(context or {})}

        if not tpl:
            return {
                "subject": ctx.get("title", "Notification"),
                "html": _wrap_html(f"<p>{ctx.get('details', '')}</p>", branding),
                "plain": ctx.get("details") or "",
            }

        subject = _render(tpl.subject, ctx)
        html_body = _render(tpl.html_body, ctx)
        plain = _render(tpl.plain_body, ctx) if tpl.plain_body else None
        return {"subject": subject, "html": _wrap_html(html_body, branding), "plain": plain}

    @staticmethod
    def send(template_key: str, recipients, context: dict | None = None) -> bool:
        rendered = EmailService.render(template_key, context)
        addrs = _parse_recipients(recipients)
        branding = _load_branding()
        return _send_smtp(addrs, rendered["subject"], rendered["html"], rendered.get("plain"), branding.get("reply_to"))

    @staticmethod
    def send_email(to_email, subject: str, html_content: str, plain_text: str | None = None) -> bool:
        branding = _load_branding()
        addrs = _parse_recipients(to_email)
        return _send_smtp(addrs, subject, html_content, plain_text, branding.get("reply_to"))

    # ---- typed wrappers -----------------------------------------------
    @staticmethod
    def send_license_expiry_alert(customer_name, hostname, notify_email, expiry_date, days_remaining) -> bool:
        return EmailService.send(
            "license_expiry",
            notify_email,
            {
                "customer_name": customer_name,
                "hostname": hostname,
                "expiry_date": expiry_date,
                "days_remaining": days_remaining,
            },
        )

    @staticmethod
    def send_update_failed_alert(customer_name, hostname, notify_email, error_message) -> bool:
        return EmailService.send(
            "update_failed",
            notify_email,
            {"customer_name": customer_name, "hostname": hostname, "error_message": error_message},
        )

    @staticmethod
    def send_offline_alert(customer_name, hostname, notify_email) -> bool:
        return EmailService.send(
            "offline", notify_email, {"customer_name": customer_name, "hostname": hostname}
        )

    @staticmethod
    def send_smart_error_alert(customer_name, hostname, notify_email, device, status) -> bool:
        return EmailService.send(
            "smart_error",
            notify_email,
            {"customer_name": customer_name, "hostname": hostname, "device": device, "status": status},
        )

    @staticmethod
    def send_generic_alert(customer_name, hostname, notify_email, severity, title, details) -> bool:
        return EmailService.send(
            "generic",
            notify_email,
            {
                "customer_name": customer_name,
                "hostname": hostname,
                "severity": (severity or "info").upper(),
                "title": title,
                "details": details,
            },
        )


parse_recipients = _parse_recipients


def resolve_firewall_recipients(firewall, kind: str = "general") -> list[str]:
    """Build the recipient list for a firewall depending on the alert kind.

    kind is "general" or "license". Falls back to the legacy ``notify_email`` field.
    """
    primary = getattr(firewall, f"notify_emails_{kind}", None)
    addrs = _parse_recipients(primary)
    if not addrs:
        addrs = _parse_recipients(getattr(firewall, "notify_email", None))
    return addrs
