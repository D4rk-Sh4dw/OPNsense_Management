import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import smtplib
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class EmailService:
    """Service for sending emails via SMTP"""

    @staticmethod
    def send_email(
        to_email: str,
        subject: str,
        html_content: str,
        plain_text: str = None
    ) -> bool:
        """
        Send email notification

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML email body
            plain_text: Plain text fallback

        Returns:
            True if successful, False otherwise
        """
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = settings.SMTP_FROM
            msg["To"] = to_email

            # Attach plain text version
            if plain_text:
                msg.attach(MIMEText(plain_text, "plain"))

            # Attach HTML version
            msg.attach(MIMEText(html_content, "html"))

            # Connect and send
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                if settings.SMTP_USE_TLS:
                    server.starttls()
                if settings.SMTP_USER and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(msg)

            logger.info(f"Email sent to {to_email}: {subject}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False

    @staticmethod
    def send_license_expiry_alert(
        customer_name: str,
        hostname: str,
        notify_email: str,
        expiry_date: str,
        days_remaining: int
    ) -> bool:
        """Send license expiry warning email"""

        subject = f"[OPNsense CMS] License Expiry Alert - {customer_name}"

        plain_text = f"""
License Expiry Alert

Customer: {customer_name}
Firewall: {hostname}
License Expiry: {expiry_date}
Days Remaining: {days_remaining}

Please renew your license to avoid service interruption.
        """

        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif;">
                <h2 style="color: #d9534f;">License Expiry Alert</h2>
                <p><strong>Customer:</strong> {customer_name}</p>
                <p><strong>Firewall:</strong> {hostname}</p>
                <p><strong>License Expiry:</strong> {expiry_date}</p>
                <p><strong style="color: #d9534f;">Days Remaining:</strong> {days_remaining}</p>
                <p style="color: #666;">Please renew your license to avoid service interruption.</p>
            </body>
        </html>
        """

        return EmailService.send_email(notify_email, subject, html_content, plain_text)

    @staticmethod
    def send_update_failed_alert(
        customer_name: str,
        hostname: str,
        notify_email: str,
        error_message: str
    ) -> bool:
        """Send firmware update failure alert"""

        subject = f"[OPNsense CMS] Update Failed - {customer_name}"

        plain_text = f"""
Firmware Update Failed

Customer: {customer_name}
Firewall: {hostname}
Error: {error_message}

Please review the update and retry manually if needed.
        """

        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif;">
                <h2 style="color: #d9534f;">Firmware Update Failed</h2>
                <p><strong>Customer:</strong> {customer_name}</p>
                <p><strong>Firewall:</strong> {hostname}</p>
                <p><strong style="color: #d9534f;">Error:</strong> {error_message}</p>
                <p style="color: #666;">Please review the update and retry manually if needed.</p>
            </body>
        </html>
        """

        return EmailService.send_email(notify_email, subject, html_content, plain_text)

    @staticmethod
    def send_offline_alert(
        customer_name: str,
        hostname: str,
        notify_email: str
    ) -> bool:
        """Send firewall offline alert"""

        subject = f"[OPNsense CMS] Firewall Offline - {customer_name}"

        plain_text = f"""
Firewall Offline Alert

Customer: {customer_name}
Firewall: {hostname}

The firewall is not responding. Please verify connectivity and status.
        """

        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif;">
                <h2 style="color: #d9534f;">Firewall Offline</h2>
                <p><strong>Customer:</strong> {customer_name}</p>
                <p><strong>Firewall:</strong> {hostname}</p>
                <p style="color: #666;">The firewall is not responding. Please verify connectivity and status.</p>
            </body>
        </html>
        """

        return EmailService.send_email(notify_email, subject, html_content, plain_text)

    @staticmethod
    def send_smart_error_alert(
        customer_name: str,
        hostname: str,
        notify_email: str,
        device: str,
        status: str
    ) -> bool:
        """Send S.M.A.R.T. failure alert"""

        subject = f"[OPNsense CMS] Disk Health Critical - {customer_name}"

        plain_text = f"""
Disk S.M.A.R.T. Error

Customer: {customer_name}
Firewall: {hostname}
Device: {device}
Status: {status}

The disk may be failing. Plan replacement immediately.
        """

        html_content = f"""
        <html>
            <body style="font-family: Arial, sans-serif;">
                <h2 style="color: #d9534f;">Disk S.M.A.R.T. Error</h2>
                <p><strong>Customer:</strong> {customer_name}</p>
                <p><strong>Firewall:</strong> {hostname}</p>
                <p><strong>Device:</strong> {device}</p>
                <p><strong style="color: #d9534f;">Status:</strong> {status}</p>
                <p style="color: #666;">The disk may be failing. Plan replacement immediately.</p>
            </body>
        </html>
        """

        return EmailService.send_email(notify_email, subject, html_content, plain_text)
