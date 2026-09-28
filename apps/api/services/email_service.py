import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import boto3
from botocore.exceptions import ClientError
from ..config import settings


class EmailService:
    """
    Email service that supports both AWS SES and standard SMTP.
    Auto-detects based on mail_provider setting in config.
    """
    
    def __init__(self):
        self.provider = settings.mail_provider
        self.from_address = settings.mail_from_address
        self.from_name = settings.mail_from_name
    
    def _get_ses_client(self):
        """Create AWS SES client."""
        return boto3.client(
            "ses",
            aws_access_key_id=settings.aws_mail_access_key_id,
            aws_secret_access_key=settings.aws_mail_secret_access_key,
            region_name=settings.aws_mail_region,
        )
    
    def _send_via_ses(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Send email via AWS SES."""
        if not settings.aws_mail_access_key_id or not settings.aws_mail_secret_access_key:
            raise ValueError("AWS SES credentials not configured")
        
        ses = self._get_ses_client()
        
        body = {"Html": {"Charset": "UTF-8", "Data": html_body}}
        if text_body:
            body["Text"] = {"Charset": "UTF-8", "Data": text_body}
        
        try:
            ses.send_email(
                Source=f"{self.from_name} <{self.from_address}>",
                Destination={"ToAddresses": [to_email]},
                Message={
                    "Subject": {"Charset": "UTF-8", "Data": subject},
                    "Body": body,
                },
            )
            return True
        except ClientError as e:
            print(f"SES error: {e.response['Error']['Message']}")
            return False
    
    def _send_via_smtp(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """Send email via SMTP server."""
        if not settings.smtp_host:
            raise ValueError("SMTP host not configured")
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{self.from_name} <{self.from_address}>"
        msg["To"] = to_email
        
        if text_body:
            msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))
        
        try:
            if settings.smtp_use_tls:
                server = smtplib.SMTP(settings.smtp_host, settings.smtp_port)
                server.starttls()
            else:
                server = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port)
            
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            
            server.sendmail(self.from_address, [to_email], msg.as_string())
            server.quit()
            return True
        except Exception as e:
            print(f"SMTP error: {e}")
            return False
    
    def send_email(
        self,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: Optional[str] = None,
    ) -> bool:
        """
        Send email using configured provider (SES or SMTP).
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            html_body: HTML content of the email
            text_body: Optional plain text fallback
            
        Returns:
            True if sent successfully, False otherwise
        """
        if self.provider == "ses":
            return self._send_via_ses(to_email, subject, html_body, text_body)
        elif self.provider == "smtp":
            return self._send_via_smtp(to_email, subject, html_body, text_body)
        else:
            raise ValueError(f"Unknown mail provider: {self.provider}")


# Singleton instance
email_service = EmailService()
