from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator

from app.models.event import EventVibe


class EvidenceState(StrEnum):
    READY = "ready"
    WAITING = "waiting"
    EXTRACTED = "extracted"
    COMPLETED = "completed"
    TERMINAL = "terminal"
    MISSING = "missing"


class ResultStatus(StrEnum):
    COMPLETED = "completed"
    RETRY = "retry"
    TERMINAL = "terminal"
    MISSING = "missing"


class EvidenceRequest(BaseModel):
    candidate_ids: list[str] = Field(min_length=1, max_length=10)

    @field_validator("candidate_ids")
    @classmethod
    def distinct_ids(cls, ids: list[str]) -> list[str]:
        if len(ids) != len(set(ids)):
            raise ValueError("candidate_ids must be unique")
        return ids


class QueueExtraction(BaseModel):
    candidate_id: str
    is_event: bool
    title: str | None = Field(default=None, max_length=500)
    event_date: datetime | None = None
    event_end_date: datetime | None = None
    location_name: str | None = Field(default=None, max_length=255)
    club_name: str | None = Field(default=None, max_length=255)
    vibes: list[EventVibe] = Field(default_factory=list)

    @field_validator("event_date", "event_end_date")
    @classmethod
    def aware_datetimes(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("datetime must include a timezone")
        return value


class QueueResult(BaseModel):
    candidate_id: str
    extraction: QueueExtraction | None = None


class ResultsRequest(BaseModel):
    model: str = Field(min_length=1, max_length=100)
    results: list[QueueResult] = Field(min_length=1, max_length=10)

    @field_validator("results")
    @classmethod
    def unique_matching_ids(cls, values: list[QueueResult]) -> list[QueueResult]:
        ids = [item.candidate_id for item in values]
        if len(ids) != len(set(ids)):
            raise ValueError("results must have unique candidate IDs")
        for item in values:
            if item.extraction and item.extraction.candidate_id != item.candidate_id:
                raise ValueError(
                    "extraction candidate_id must match result candidate_id"
                )
        return values


class TerminalRequest(BaseModel):
    candidate_id: str
    error: str = Field(min_length=1, max_length=2000)


class CaptureStatus(StrEnum):
    READY = "ready"
    COMPLETED = "completed"


class CaptureReadyResponse(BaseModel):
    candidate_id: str
    status: CaptureStatus
    dispatched: bool
