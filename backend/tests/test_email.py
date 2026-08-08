from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from app.services.email import (
    EmailDeliveryError,
    OutboundEmail,
    SesEmailSender,
    send_otp_email,
)


@pytest.fixture
def message() -> OutboundEmail:
    return OutboundEmail(
        to=("recipient@example.com",),
        subject="Test subject",
        text="Plain text",
        html="<p>HTML</p>",
    )


async def test_ses_sender_uses_ses_api(message: OutboundEmail):
    client = MagicMock()
    client.send_email.return_value = {"MessageId": "ses-message-id"}

    with (
        patch("app.services.email.boto3.client", return_value=client),
        patch(
            "app.services.email.asyncio.to_thread",
            new=AsyncMock(side_effect=lambda func, **kwargs: func(**kwargs)),
        ),
    ):
        sender = SesEmailSender("sender@example.com", "us-west-2")
        message_id = await sender.send(message)

    assert message_id == "ses-message-id"
    client.send_email.assert_called_once_with(
        FromEmailAddress="sender@example.com",
        Destination={"ToAddresses": ["recipient@example.com"]},
        Content={
            "Simple": {
                "Subject": {"Data": "Test subject", "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": "Plain text", "Charset": "UTF-8"},
                    "Html": {"Data": "<p>HTML</p>", "Charset": "UTF-8"},
                },
            }
        },
    )


async def test_ses_sender_translates_client_errors(message: OutboundEmail):
    client = MagicMock()
    client.send_email.side_effect = ClientError(
        {
            "Error": {"Code": "MessageRejected", "Message": "Rejected"},
            "ResponseMetadata": {
                "RequestId": "request-123",
                "HTTPStatusCode": 400,
                "HostId": "host-123",
                "HTTPHeaders": {},
                "RetryAttempts": 0,
            },
        },
        "SendEmail",
    )

    with (
        patch("app.services.email.boto3.client", return_value=client),
        patch("app.services.email.logger") as logger,
        patch(
            "app.services.email.asyncio.to_thread",
            new=AsyncMock(side_effect=lambda func, **kwargs: func(**kwargs)),
        ),
    ):
        sender = SesEmailSender("sender@example.com", "us-west-2")
        with pytest.raises(EmailDeliveryError):
            await sender.send(message)

    logger.error.assert_called_once_with(
        "SES rejected email: code=%s message=%s request_id=%s status_code=%s",
        "MessageRejected",
        "Rejected",
        "request-123",
        400,
        exc_info=True,
    )


async def test_otp_email_delegates_to_sender():
    sender = AsyncMock()
    sender.send.return_value = "message-id"

    await send_otp_email("recipient@example.com", "123456", sender)

    message = sender.send.await_args.args[0]
    assert message.to == ("recipient@example.com",)
    assert "123456" in message.subject
    assert "123456" in message.text
    assert "123456" in message.html


async def test_otp_email_reports_delivery_failure():
    sender = AsyncMock()
    sender.send.side_effect = EmailDeliveryError("failed")

    with pytest.raises(EmailDeliveryError):
        await send_otp_email("recipient@example.com", "123456", sender)
