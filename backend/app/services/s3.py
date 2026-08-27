from functools import lru_cache
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings

PRESIGNED_DOWNLOAD_EXPIRES_IN = 3600


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
    _client().delete_object(Bucket=settings.s3_bucket_name, Key=file_key)


def copy_object(source_key: str, destination_key: str) -> None:
    _client().copy_object(
        Bucket=settings.s3_bucket_name,
        CopySource={"Bucket": settings.s3_bucket_name, "Key": source_key},
        Key=destination_key,
    )


def generate_presigned_download_url(
    file_key: str,
    *,
    expires_in: int = PRESIGNED_DOWNLOAD_EXPIRES_IN,
) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket_name, "Key": file_key},
        ExpiresIn=expires_in,
    )


def public_url(file_key: str) -> str:
    return f"{settings.s3_public_base_url.rstrip('/')}/{quote(file_key, safe='/')}"


def object_exists(file_key: str) -> bool:
    try:
        _client().head_object(Bucket=settings.s3_bucket_name, Key=file_key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise
    return True


def get_object_bytes(file_key: str) -> bytes:
    response = _client().get_object(Bucket=settings.s3_bucket_name, Key=file_key)
    return response["Body"].read()
