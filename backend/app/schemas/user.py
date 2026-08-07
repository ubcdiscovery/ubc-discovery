import uuid
from datetime import datetime

from pydantic import BaseModel


class OnboardingRequest(BaseModel):
    preferred_name: str
    major: str | None = None
    year_standing: int | None = None
    faculty: str | None = None
    interests: list[str] | None = None
    bio: str | None = None


class UpdateProfileRequest(BaseModel):
    preferred_name: str | None = None
    major: str | None = None
    year_standing: int | None = None
    faculty: str | None = None
    interests: list[str] | None = None
    bio: str | None = None


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    preferred_name: str
    major: str | None
    year_standing: int | None
    faculty: str | None
    interests: list[str] | None
    bio: str | None
    profile_picture_url: str | None = None
    is_admin: bool
    ubc_verified: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserStatsResponse(BaseModel):
    member_since: datetime


class PresignedUploadResponse(BaseModel):
    upload_url: str
    fields: dict[str, str]
    file_key: str
    max_file_size_bytes: int
