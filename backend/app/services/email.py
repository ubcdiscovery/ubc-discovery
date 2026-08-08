import asyncio
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutboundEmail:
    to: tuple[str, ...]
    subject: str
    text: str
    html: str


class EmailDeliveryError(Exception):
    """Raised when an email provider cannot accept a message."""


class EmailSender(Protocol):
    async def send(self, message: OutboundEmail) -> str: ...


class SesEmailSender:
    def __init__(self, sender_email: str, region_name: str) -> None:
        self._sender_email = sender_email
        self._client = boto3.client("sesv2", region_name=region_name)

    async def send(self, message: OutboundEmail) -> str:
        body = {
            "Text": {"Data": message.text, "Charset": "UTF-8"},
            "Html": {"Data": message.html, "Charset": "UTF-8"},
        }

        try:
            response = await asyncio.to_thread(
                self._client.send_email,
                FromEmailAddress=self._sender_email,
                Destination={"ToAddresses": list(message.to)},
                Content={
                    "Simple": {
                        "Subject": {"Data": message.subject, "Charset": "UTF-8"},
                        "Body": body,
                    }
                },
            )
        except ClientError as exc:
            error = exc.response.get("Error", {})
            metadata = exc.response.get("ResponseMetadata", {})
            logger.error(
                "SES rejected email: code=%s message=%s request_id=%s status_code=%s",
                error.get("Code"),
                error.get("Message"),
                metadata.get("RequestId"),
                metadata.get("HTTPStatusCode"),
                exc_info=True,
            )
            raise EmailDeliveryError("SES rejected the email") from exc
        except BotoCoreError as exc:
            logger.exception("SES request failed: %s", exc)
            raise EmailDeliveryError("SES rejected the email") from exc

        return response["MessageId"]


@lru_cache
def get_email_sender() -> EmailSender:
    return SesEmailSender(
        sender_email=settings.email_sender_email,
        region_name=settings.aws_region,
    )


async def send_otp_email(
    to_email: str,
    otp_code: str,
    sender: EmailSender | None = None,
) -> None:
    text = (
        f"Your verification code is: {otp_code}\n\n"
        f"This code expires in {settings.otp_expiry_minutes} minutes."
    )
    body_style = (
        "font-family: system-ui, sans-serif; max-width: 480px; "
        "margin: 0 auto; padding: 32px;"
    )
    heading_style = "color: #007AFF; margin-bottom: 8px;"
    code_container_style = (
        "background: #f5f5f5; border-radius: 8px; padding: 24px; "
        "text-align: center; margin: 24px 0;"
    )
    code_style = (
        "font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007AFF;"
    )
    expiry_message = f"This code expires in {settings.otp_expiry_minutes} minutes."
    ignore_message = (
        "If you didn't request this code, you can safely ignore this email."
    )
    html = f"""\
<html>
<body style="{body_style}">
  <h2 style="{heading_style}">UBC Discovery</h2>
  <p style="color: #333; font-size: 16px;">Your verification code is:</p>
  <div style="{code_container_style}">
    <span style="{code_style}">{otp_code}</span>
  </div>
  <p style="color: #666; font-size: 14px;">{expiry_message}</p>
  <p style="color: #999; font-size: 12px;">{ignore_message}</p>
</body>
</html>"""
    message = OutboundEmail(
        to=(to_email,),
        subject=f"Your UBC Discovery verification code: {otp_code}",
        text=text,
        html=html,
    )

    await (sender or get_email_sender()).send(message)
