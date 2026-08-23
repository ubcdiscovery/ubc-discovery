import uuid
from unittest.mock import MagicMock

from app.config import settings
from app.presenters.event import event_image_key
from app.services import s3
from app.services.candidate_images import candidate_image_key


def test_generate_presigned_upload_url_enforces_profile_photo_size(monkeypatch):
    client = MagicMock()
    client.generate_presigned_post.return_value = {
        "url": "https://s3.example.com/presigned",
        "fields": {"key": "profile-pictures/mock"},
    }
    monkeypatch.setattr(s3, "_client", lambda: client)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket")
    monkeypatch.setattr(settings, "profile_photo_max_bytes", 1234)

    upload_url, fields, file_key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key="profile-pictures/mock",
        max_file_size_bytes=settings.profile_photo_max_bytes,
    )

    assert upload_url == "https://s3.example.com/presigned"
    assert fields == {"key": "profile-pictures/mock"}
    assert file_key.startswith("profile-pictures/")
    client.generate_presigned_post.assert_called_once()
    kwargs = client.generate_presigned_post.call_args.kwargs
    assert kwargs["Bucket"] == "test-bucket"
    assert kwargs["Fields"]["Content-Type"] == "image/webp"
    assert ["content-length-range", 1, 1234] in kwargs["Conditions"]


def test_generate_presigned_upload_url_supports_event_image_key_and_size(monkeypatch):
    client = MagicMock()
    client.generate_presigned_post.return_value = {
        "url": "https://s3.example.com/presigned",
        "fields": {"key": "event-pictures/abc12345.webp"},
    }
    monkeypatch.setattr(s3, "_client", lambda: client)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket")

    upload_url, fields, file_key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key=event_image_key("abc12345"),
        max_file_size_bytes=3 * 1024 * 1024,
    )

    assert upload_url == "https://s3.example.com/presigned"
    assert fields == {"key": "event-pictures/abc12345.webp"}
    assert file_key == "event-pictures/abc12345.webp"
    client.generate_presigned_post.assert_called_once()
    kwargs = client.generate_presigned_post.call_args.kwargs
    assert kwargs["Key"] == "event-pictures/abc12345.webp"
    assert ["content-length-range", 1, 3 * 1024 * 1024] in kwargs["Conditions"]


def test_generate_presigned_upload_url_supports_candidate_image_key_and_size(
    monkeypatch,
):
    client = MagicMock()
    client.generate_presigned_post.return_value = {
        "url": "https://s3.example.com/presigned",
        "fields": {"key": "candidates/11111111-1111-1111-1111-111111111111/00.jpg"},
    }
    monkeypatch.setattr(s3, "_client", lambda: client)
    monkeypatch.setattr(settings, "s3_bucket_name", "test-bucket")

    candidate_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    file_key = candidate_image_key(candidate_id, 0, "image/jpeg")
    upload_url, fields, returned_key = s3.generate_presigned_upload_url(
        content_type="image/jpeg",
        file_key=file_key,
        max_file_size_bytes=5 * 1024 * 1024,
    )

    assert upload_url == "https://s3.example.com/presigned"
    assert fields == {"key": "candidates/11111111-1111-1111-1111-111111111111/00.jpg"}
    assert returned_key == "candidates/11111111-1111-1111-1111-111111111111/00.jpg"
    kwargs = client.generate_presigned_post.call_args.kwargs
    assert kwargs["Key"] == "candidates/11111111-1111-1111-1111-111111111111/00.jpg"
    assert kwargs["Fields"]["Content-Type"] == "image/jpeg"
    assert ["content-length-range", 1, 5 * 1024 * 1024] in kwargs["Conditions"]
