from datetime import datetime
from typing import Self

from pydantic import BaseModel, Field, field_validator, model_validator

EVENT_SOURCE_LABELS = ("ubc_official", "ams_club", "campus_community")
EVENT_VIBES = (
    "social",
    "career",
    "academic",
    "arts",
    "culture",
    "outdoors",
    "sports",
    "food",
    "wellness",
    "volunteering",
)


class EventResponse(BaseModel):
    id: str
    title: str
    description: str
    source: str
    source_label: str
    source_url: str | None
    external_cta_label: str | None
    club_name: str | None
    event_picture_url: str | None = None
    vibes: list[str]
    location_name: str | None
    event_date: datetime | None
    event_end_date: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateEventRequest(BaseModel):
    title: str
    description: str = ""
    source: str = Field(default="manual", min_length=1, max_length=50)
    club_name: str | None = None
    source_label: str = "campus_community"
    source_url: str | None = None
    external_cta_label: str | None = None
    vibes: list[str] = Field(default_factory=list)
    location_name: str | None = None
    event_date: datetime
    event_end_date: datetime | None = None

    @model_validator(mode="after")
    def validate_end_after_start(self) -> "CreateEventRequest":
        if self.event_end_date and self.event_end_date < self.event_date:
            raise ValueError("event_end_date must not be before event_date")
        return self

    @field_validator("source_label")
    @classmethod
    def validate_source_label(cls, value: str) -> str:
        if value not in EVENT_SOURCE_LABELS:
            raise ValueError(
                "source_label must be one of the fixed event source labels"
            )
        return value

    @field_validator("vibes")
    @classmethod
    def validate_vibes(cls, value: list[str]) -> list[str]:
        invalid = [vibe for vibe in value if vibe not in EVENT_VIBES]
        if invalid:
            raise ValueError("vibes must use the fixed event vibe taxonomy")
        return value


class UpdateEventRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    source: str | None = Field(default=None, min_length=1, max_length=50)
    club_name: str | None = None
    source_label: str | None = None
    source_url: str | None = None
    external_cta_label: str | None = None
    vibes: list[str] | None = None
    location_name: str | None = None
    event_date: datetime | None = None
    event_end_date: datetime | None = None

    @field_validator(
        "title", "description", "source", "source_label", "vibes", mode="before"
    )
    @classmethod
    def reject_null_required_fields(cls, value):
        if value is None:
            raise ValueError("field must not be null")
        return value

    @model_validator(mode="after")
    def validate_end_after_start(self) -> Self:
        if (
            self.event_date
            and self.event_end_date
            and self.event_end_date < self.event_date
        ):
            raise ValueError("event_end_date must not be before event_date")
        return self

    @field_validator("source_label")
    @classmethod
    def validate_source_label(cls, value: str | None) -> str | None:
        if value is not None and value not in EVENT_SOURCE_LABELS:
            raise ValueError(
                "source_label must be one of the fixed event source labels"
            )
        return value

    @field_validator("vibes")
    @classmethod
    def validate_vibes(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        invalid = [vibe for vibe in value if vibe not in EVENT_VIBES]
        if invalid:
            raise ValueError("vibes must use the fixed event vibe taxonomy")
        return value


class EventListResponse(BaseModel):
    events: list[EventResponse]
