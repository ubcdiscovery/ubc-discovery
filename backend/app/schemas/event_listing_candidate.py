import re
import uuid
from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.event import EVENT_VIBES

CandidateStatus = Literal["pending", "approved", "rejected"]
CandidateIngestionOutcome = Literal["created", "existing"]
_EMAIL_PATTERN = re.compile(r"\b[\w.+-]+@[\w.-]+\.\w+\b")
_PRIVATE_METADATA_KEY_PATTERN = re.compile(
    r"(?:^|_)(?:raw|email|phone|personal|content|body|html|excerpt)(?:_|$)",
    re.IGNORECASE,
)


class EventListingCandidateIngestionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=20_000)
    club_name: str | None = Field(default=None, max_length=255)
    source_url: str | None = Field(default=None, max_length=1024)
    external_cta_label: str | None = Field(default=None, max_length=80)
    vibes: list[str] = Field(default_factory=list)
    location_name: str | None = Field(default=None, max_length=255)
    event_date: datetime | None = None
    event_end_date: datetime | None = None

    source_type: str = Field(min_length=1, max_length=50)
    external_source_id: str = Field(min_length=1, max_length=512)
    source_excerpt: str | None = Field(default=None, max_length=4_000)
    image_reference: str | None = Field(default=None, max_length=1024)
    extraction_confidence: float = Field(ge=0, le=1)
    extraction_metadata: dict[str, str | int | float | bool | None] = Field(
        default_factory=dict
    )

    @model_validator(mode="after")
    def validate_end_after_start(self) -> Self:
        if (
            self.event_date
            and self.event_end_date
            and self.event_end_date < self.event_date
        ):
            raise ValueError("event_end_date must not be before event_date")
        return self

    @field_validator("title", "source_type", "external_source_id")
    @classmethod
    def strip_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field must contain text")
        return value

    @field_validator("club_name", "location_name", "source_url", "image_reference")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("vibes")
    @classmethod
    def validate_vibes(cls, value: list[str]) -> list[str]:
        invalid = [vibe for vibe in value if vibe not in EVENT_VIBES]
        if invalid:
            raise ValueError("vibes must use the fixed event vibe taxonomy")
        return value

    @field_validator("source_excerpt")
    @classmethod
    def reject_private_source_content(cls, value: str | None) -> str | None:
        if value is not None and _EMAIL_PATTERN.search(value):
            raise ValueError("source_excerpt must not contain email addresses")
        return value.strip() if value is not None else None

    @field_validator("extraction_metadata")
    @classmethod
    def validate_extraction_metadata(
        cls, value: dict[str, str | int | float | bool | None]
    ) -> dict[str, str | int | float | bool | None]:
        for key, item in value.items():
            if len(key) > 64:
                raise ValueError(
                    "extraction_metadata keys must be 64 characters or fewer"
                )
            if _PRIVATE_METADATA_KEY_PATTERN.search(key):
                raise ValueError(
                    "extraction_metadata must not contain personal or raw source data"
                )
            if isinstance(item, str) and len(item) > 500:
                raise ValueError(
                    "extraction_metadata string values must be 500 characters or fewer"
                )
            if isinstance(item, str) and _EMAIL_PATTERN.search(item):
                raise ValueError(
                    "extraction_metadata must not contain email addresses"
                )
        return value


class EventListingCandidateResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    club_name: str | None
    source_url: str | None
    external_cta_label: str | None
    vibes: list[str]
    location_name: str | None
    event_date: datetime | None
    event_end_date: datetime | None
    source_type: str
    external_source_id: str
    source_excerpt: str | None
    image_reference: str | None
    extraction_confidence: float
    extraction_metadata: dict
    extraction_output: dict
    status: CandidateStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventListingCandidateIngestionAuditResponse(BaseModel):
    id: uuid.UUID
    source_type: str
    external_source_id: str
    outcome: CandidateIngestionOutcome
    credential_name: str
    received_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventListingCandidateDetailResponse(EventListingCandidateResponse):
    ingestion_audits: list[EventListingCandidateIngestionAuditResponse]


class AdminEventListingCandidateListResponse(BaseModel):
    candidates: list[EventListingCandidateResponse]
    total: int


class EventListingCandidateIngestionResponse(BaseModel):
    outcome: CandidateIngestionOutcome
    receipt_id: uuid.UUID
    candidate: EventListingCandidateResponse
