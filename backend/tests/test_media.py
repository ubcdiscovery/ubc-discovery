"""The local media store must stay inert unless it is explicitly switched on."""

import pytest

from app.config import settings
from app.services import s3


@pytest.fixture
def local_media(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "local_media_dir", str(tmp_path))
    monkeypatch.setattr(settings, "s3_bucket_name", "")
    monkeypatch.setattr(settings, "s3_public_base_url", "http://testserver/media")
    return tmp_path


def test_disabled_without_a_media_dir(monkeypatch):
    monkeypatch.setattr(settings, "local_media_dir", "")
    monkeypatch.setattr(settings, "s3_bucket_name", "")

    assert s3.local_media_enabled() is False


def test_a_real_bucket_always_wins(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "local_media_dir", str(tmp_path))
    monkeypatch.setattr(settings, "s3_bucket_name", "prod-bucket")

    assert s3.local_media_enabled() is False


def test_upload_url_points_at_the_media_route(local_media):
    url, fields, key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key="submission-pictures/abc.webp",
        max_file_size_bytes=1024,
    )

    assert url == "http://testserver/media/submission-pictures/abc.webp"
    assert fields == {}
    assert key == "submission-pictures/abc.webp"


def test_path_traversal_is_refused(local_media):
    with pytest.raises(ValueError):
        s3.local_media_path("../../etc/passwd")


async def test_round_trips_a_file(unauthed_client, local_media):
    response = await unauthed_client.post(
        "/media/submission-pictures/abc.webp",
        files={"file": ("abc.webp", b"pretend-image-bytes", "image/webp")},
    )
    assert response.status_code == 204
    assert (local_media / "submission-pictures" / "abc.webp").read_bytes() == (
        b"pretend-image-bytes"
    )

    read = await unauthed_client.get("/media/submission-pictures/abc.webp")
    assert read.status_code == 200
    assert read.content == b"pretend-image-bytes"


async def test_route_is_hidden_when_disabled(unauthed_client, monkeypatch):
    monkeypatch.setattr(settings, "local_media_dir", "")

    upload = await unauthed_client.post(
        "/media/x.webp", files={"file": ("x.webp", b"data", "image/webp")}
    )
    read = await unauthed_client.get("/media/x.webp")

    assert upload.status_code == 404
    assert read.status_code == 404


async def test_rejects_an_oversized_file(unauthed_client, local_media, monkeypatch):
    monkeypatch.setattr(settings, "event_image_max_bytes", 10)

    response = await unauthed_client.post(
        "/media/big.webp", files={"file": ("big.webp", b"x" * 50, "image/webp")}
    )

    assert response.status_code == 413


def test_delete_removes_the_local_file(local_media):
    target = local_media / "submission-pictures" / "gone.webp"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"bytes")

    s3.delete_object("submission-pictures/gone.webp")

    assert not target.exists()
