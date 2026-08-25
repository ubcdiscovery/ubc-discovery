import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.audit_actor import AuditActorType
from app.models.event_listing_candidate import (
    CandidateIngestionOutcome,
    CandidateStatus,
)
from app.schemas.user import PresignedUploadResponse
from app.services.candidate_images import (
    CANDIDATE_IMAGE_CONTENT_TYPES,
    CANDIDATE_IMAGE_MAX_COUNT,
)


class CandidateSourceIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: str = Field(min_length=1, max_length=50)
    external_source_id: str = Field(min_length=1, max_length=512)

    @field_validator("source_type", "external_source_id")
    @classmethod
    def strip_source_identity(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field must contain text")
        return value


class EventListingCandidateIngestionRequest(CandidateSourceIdentity):
    description: str = Field(default="", max_length=20_000)
    source_account: str = Field(min_length=1, max_length=255)
    source_url: str | None = Field(default=None, max_length=1024)
    posted_at: datetime | None = None
    image_content_types: list[str] = Field(max_length=CANDIDATE_IMAGE_MAX_COUNT)

    @field_validator("image_content_types")
    @classmethod
    def validate_image_content_types(cls, value: list[str]) -> list[str]:
        invalid = [
            content_type
            for content_type in value
            if content_type not in CANDIDATE_IMAGE_CONTENT_TYPES
        ]
        if invalid:
            raise ValueError(
                "image_content_types must contain only "
                "image/jpeg, image/png, or image/webp"
            )
        return value

    @field_validator("description")
    @classmethod
    def strip_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("source_account")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field must contain text")
        return value

    @field_validator("source_url")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class EventListingCandidateResponse(BaseModel):
    id: uuid.UUID
    description: str
    source_account: str
    source_url: str | None
    source_type: str
    external_source_id: str
    status: CandidateStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventListingCandidateAdminResponse(EventListingCandidateResponse):
    image_urls: list[str] = Field(
        default_factory=list,
        description=(
            "Time-limited signed download URLs for ingested source images. "
            "Empty when no images were uploaded."
        ),
    )
    posted_at: datetime | None = None
    is_event: bool | None = None
    title: str | None = None
    location_name: str | None = None
    event_date: datetime | None = None
    event_end_date: datetime | None = None
    club_name: str | None = None
    vibes: list[str] = Field(default_factory=list)
    source_label: str | None = None
    extracted_original: dict | list | None = None
    extraction_model: str | None = None
    extracted_at: datetime | None = None


class EventListingCandidateIngestionAuditResponse(BaseModel):
    id: uuid.UUID
    source_type: str
    external_source_id: str
    outcome: CandidateIngestionOutcome
    actor_type: AuditActorType
    actor_id: uuid.UUID
    credential_label: str
    received_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventListingCandidateDetailResponse(EventListingCandidateAdminResponse):
    ingestion_audits: list[EventListingCandidateIngestionAuditResponse]


class AdminCandidateListQuery(BaseModel):
    q: str = ""
    status: CandidateStatus | None = None
    source_type: str | None = Field(default=None, min_length=1, max_length=50)
    skip: int = Field(default=0, ge=0)
    limit: int = Field(default=25, ge=1, le=100)

    @field_validator("q")
    @classmethod
    def strip_search(cls, value: str) -> str:
        return value.strip()

    @field_validator("source_type", mode="before")
    @classmethod
    def empty_source_as_none(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        stripped = value.strip()
        return stripped or None


class AdminEventListingCandidateListResponse(BaseModel):
    candidates: list[EventListingCandidateAdminResponse]
    total: int


class EventListingCandidateIngestionResponse(BaseModel):
    outcome: CandidateIngestionOutcome
    receipt_id: uuid.UUID
    candidate: EventListingCandidateResponse
    uploads: list[PresignedUploadResponse]
