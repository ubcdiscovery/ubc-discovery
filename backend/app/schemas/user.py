import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints


class FacultyId(StrEnum):
    APPLIED_SCIENCE = "applied-science"
    ARCHITECTURE_LANDSCAPE_ARCHITECTURE = "architecture-landscape-architecture"
    ARTS = "arts"
    SAUDER = "sauder"
    DENTISTRY = "dentistry"
    EDUCATION = "education"
    FORESTRY_ENVIRONMENTAL_STEWARDSHIP = "forestry-environmental-stewardship"
    KINESIOLOGY = "kinesiology"
    LAND_FOOD_SYSTEMS = "land-food-systems"
    LAW = "law"
    MEDICINE = "medicine"
    MUSIC = "music"
    NURSING = "nursing"
    PHARMACEUTICAL_SCIENCES = "pharmaceutical-sciences"
    SCIENCE = "science"
    SOCIAL_WORK = "social-work"
    VANTAGE_COLLEGE = "vantage-college"
    VANCOUVER_SCHOOL_ECONOMICS = "vancouver-school-economics"
    OTHER = "other"


class AcademicLevel(StrEnum):
    YEAR_1 = "year_1"
    YEAR_2 = "year_2"
    YEAR_3 = "year_3"
    YEAR_4 = "year_4"
    YEAR_5_PLUS = "year_5_plus"
    GRADUATE = "graduate"
    POSTDOC = "postdoc"
    OTHER = "other"


ProfileName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
Major = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]


class OnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred_name: ProfileName
    major: Major | None = None
    academic_level: AcademicLevel | None = None
    faculty_id: FacultyId | None = None
    interests: list[str] | None = None
    bio: str | None = None


class UpdateProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preferred_name: ProfileName | None = None
    major: Major | None = None
    academic_level: AcademicLevel | None = None
    faculty_id: FacultyId | None = None
    interests: list[str] | None = None
    bio: str | None = None


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    preferred_name: str
    major: str | None
    academic_level: AcademicLevel | None
    faculty_id: FacultyId | None
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
