import uuid
from datetime import datetime, timezone
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.event import EVENT_VIBES

# Organizers cannot label their own event as official UBC programming;
# a reviewer can promote the source label when approving.
SUBMITTABLE_SOURCE_LABELS = ("ams_club", "campus_community")

MAX_SUBMISSION_VIBES = 3


class CreateEventSubmissionRequest(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    description: str = Field(default="", max_length=4000)
    club_name: str = Field(min_length=2, max_length=255)
    source_label: str = "campus_community"
    source_url: str | None = Field(default=None, max_length=1024)
    external_cta_label: str | None = Field(default=None, max_length=80)
    vibes: list[str] = Field(min_length=1, max_length=MAX_SUBMISSION_VIBES)
    location_name: str = Field(min_length=2, max_length=255)
    event_date: datetime
    event_end_date: datetime | None = None

    @field_validator("source_label")
    @classmethod
    def validate_source_label(cls, value: str) -> str:
        if value not in SUBMITTABLE_SOURCE_LABELS:
            raise ValueError(
                "source_label must be one of the organizer-submittable source labels"
            )
        return value

    @field_validator("vibes")
    @classmethod
    def validate_vibes(cls, value: list[str]) -> list[str]:
        invalid = [vibe for vibe in value if vibe not in EVENT_VIBES]
        if invalid:
            raise ValueError("vibes must use the fixed event vibe taxonomy")
        if len(set(value)) != len(value):
            raise ValueError("vibes must not repeat")
        return value

    @field_validator("source_url")
    @classmethod
    def validate_source_url(cls, value: str | None) -> str | None:
        if value is None:
            return value
        trimmed = value.strip()
        if not trimmed:
            return None
        if not trimmed.startswith(("http://", "https://")):
            raise ValueError("source_url must start with http:// or https://")
        return trimmed

    @model_validator(mode="after")
    def validate_dates(self) -> Self:
        if self.event_date <= datetime.now(timezone.utc):
            raise ValueError("event_date must be in the future")
        if self.event_end_date and self.event_end_date < self.event_date:
            raise ValueError("event_end_date must not be before event_date")
        return self


class ReviewSubmissionRequest(BaseModel):
    review_note: str | None = Field(default=None, max_length=1000)


class EventSubmissionResponse(BaseModel):
    id: uuid.UUID
    submitted_by_id: uuid.UUID
    title: str
    description: str
    club_name: str
    source_label: str
    source_url: str | None
    external_cta_label: str | None
    vibes: list[str]
    location_name: str
    event_date: datetime
    event_end_date: datetime | None
    event_picture_url: str | None = None
    status: str
    review_note: str | None
    reviewed_at: datetime | None
    published_event_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EventSubmissionListResponse(BaseModel):
    submissions: list[EventSubmissionResponse]
    total: int
