from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.config import Config

from app.config import settings


def local_media_enabled() -> bool:
    """Local disk stands in for S3 only when a dir is set and no bucket is."""
    return bool(settings.local_media_dir) and not settings.s3_bucket_name


def local_media_path(file_key: str) -> Path:
    """Resolve a key under the media dir, refusing anything that escapes it."""
    root = Path(settings.local_media_dir).resolve()
    target = (root / file_key).resolve()
    if not target.is_relative_to(root):
        raise ValueError("file key escapes the media directory")
    return target


@lru_cache
def _client():
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
        ),
    )


def generate_presigned_upload_url(
    *,
    content_type: str,
    file_key: str,
    max_file_size_bytes: int,
) -> tuple[str, dict[str, str], str]:
    if local_media_enabled():
        # Same URL the browser will later read the image from, so one route
        # handles both the upload and the download in development.
        return public_url(file_key), {}, file_key

    post = _client().generate_presigned_post(
        Bucket=settings.s3_bucket_name,
        Key=file_key,
        Fields={
            "Content-Type": content_type,
        },
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, max_file_size_bytes],
        ],
        ExpiresIn=300,
    )
    return post["url"], post["fields"], file_key


def delete_object(file_key: str) -> None:
    if local_media_enabled():
        local_media_path(file_key).unlink(missing_ok=True)
        return
    _client().delete_object(Bucket=settings.s3_bucket_name, Key=file_key)


def public_url(file_key: str) -> str:
    return f"{settings.s3_public_base_url.rstrip('/')}/{quote(file_key, safe='/')}"
