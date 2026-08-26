import uuid
from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.audit_actor import AuditActorType
from app.models.event import EventSourceLabel, EventVibe
from app.models.event_audit import EventAuditAction

EVENT_SOURCE_LABELS = tuple(label.value for label in EventSourceLabel)
EVENT_VIBES = tuple(vibe.value for vibe in EventVibe)


class EventResponse(BaseModel):
    id: str
    title: str
    description: str
    source: str
    source_label: EventSourceLabel
    source_url: str | None
    club_name: str | None
    event_picture_url: str | None = None
    vibes: list[EventVibe]
    location_name: str
    event_date: datetime | None
    event_end_date: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AdminEventResponse(EventResponse):
    is_archived: bool
    archived_at: datetime | None
    archived_by: uuid.UUID | None


class CreateEventRequest(BaseModel):
    title: str
    description: str = ""
    source: str = Field(default="manual", min_length=1, max_length=50)
    club_name: str | None = None
    source_label: EventSourceLabel = EventSourceLabel.CAMPUS_COMMUNITY
    source_url: str | None = None
    vibes: list[EventVibe] = Field(default_factory=list)
    location_name: str = Field(min_length=1)
    event_date: datetime
    event_end_date: datetime | None = None

    @model_validator(mode="after")
    def validate_end_after_start(self) -> CreateEventRequest:
        if self.event_end_date and self.event_end_date < self.event_date:
            raise ValueError("event_end_date must not be before event_date")
        return self

    @field_validator("location_name")
    @classmethod
    def validate_location_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("location_name must contain location text")
        return value.strip()


class UpdateEventRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    source: str | None = Field(default=None, min_length=1, max_length=50)
    club_name: str | None = None
    source_label: EventSourceLabel | None = None
    source_url: str | None = None
    vibes: list[EventVibe] | None = None
    location_name: str | None = Field(default=None, min_length=1)
    event_date: datetime | None = None
    event_end_date: datetime | None = None

    @field_validator(
        "title",
        "description",
        "source",
        "source_label",
        "vibes",
        "location_name",
        mode="before",
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

    @field_validator("location_name")
    @classmethod
    def validate_location_name(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("location_name must contain location text")
        return value.strip() if value is not None else None


class EventListResponse(BaseModel):
    events: list[EventResponse]


class AdminEventListResponse(BaseModel):
    events: list[AdminEventResponse]
    total: int


class EventAuditResponse(BaseModel):
    id: uuid.UUID
    event_id: str
    actor_type: AuditActorType
    actor_id: uuid.UUID
    action: EventAuditAction
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventAuditListResponse(BaseModel):
    entries: list[EventAuditResponse]


EventAdminStatus = Literal["all", "active", "archived"]
