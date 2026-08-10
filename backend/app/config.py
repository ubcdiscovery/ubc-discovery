from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = ""
    # asyncpg SSL mode. RDS requires SSL; a local Postgres usually has it off,
    # so local dev can set DATABASE_SSL=prefer.
    database_ssl: str = "require"

    aws_region: str = "us-west-2"
    s3_bucket_name: str = ""
    s3_public_base_url: str = ""
    # LOCAL DEVELOPMENT ONLY. When set (and no S3 bucket is configured),
    # uploads are written here and served from /media instead of S3.
    local_media_dir: str = ""
    profile_photo_max_bytes: int = 512 * 1024
    event_image_max_bytes: int = 3 * 1024 * 1024

    firebase_credentials_json: str = ""
    firebase_project_id: str = ""

    email_sender_email: str = ""
    otp_expiry_minutes: int = 10
    otp_max_attempts: int = 5
    otp_rate_limit_per_15min: int = 3

    admin_api_key: str = ""

    # LOCAL DEVELOPMENT ONLY. Accepts the web app's VITE_AUTH_TEST_MODE tokens so
    # signed-in screens can be used without a Firebase project. Ignored whenever
    # firebase_credentials_json is set, so it cannot weaken a real environment.
    auth_dev_bypass: bool = False

    cors_allowed_origins: list[str] = [
        "http://localhost:5173",  # React Router web dev server
    ]
    cors_allowed_origin_regex: str | None = None

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
