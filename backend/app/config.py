from typing import Literal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""
    database_ssl: bool = True

    aws_region: str = "us-west-2"
    s3_bucket_name: str = ""
    s3_public_base_url: str = ""
    profile_photo_max_bytes: int = 512 * 1024
    event_image_max_bytes: int = 3 * 1024 * 1024
    candidate_image_max_bytes: int = 5 * 1024 * 1024

    firebase_credentials_json: str = ""
    firebase_project_id: str = ""

    email_sender_email: str = ""
    otp_expiry_minutes: int = 10
    otp_max_attempts: int = 5
    otp_rate_limit_per_15min: int = 3

    cors_allowed_origins: list[str] = [
        "http://localhost:5173",  # React Router web dev server
    ]
    cors_allowed_origin_regex: str | None = None

    openai_api_key: str = ""
    extraction_enabled: bool = False
    extraction_model: str = "gpt-5.6-luna"
    extraction_reasoning_effort: Literal[
        "none", "minimal", "low", "medium", "high", "xhigh", "max"
    ] = "none"
    extraction_image_detail: Literal["auto", "low", "high"] = "high"
    extraction_batch_size: int = 10
    extraction_quiet_seconds: int = 120
    extraction_image_wait_seconds: int = 300
    extraction_image_retry_seconds: int = 15
    extraction_poll_seconds: float = 5
    extraction_idle_seconds: float = 20
    extraction_claim_timeout_seconds: int = 300
    extraction_max_attempts: int = 5

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
