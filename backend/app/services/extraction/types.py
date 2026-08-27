from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class EvidenceImage:
    key: str
    media_type: str
    content: bytes


@dataclass(frozen=True)
class ExtractionEvidence:
    candidate_id: str
    caption: str
    source_account: str
    source_type: str
    posted_at: datetime | None
    created_at: datetime
    images: tuple[EvidenceImage, ...] = ()
    pending_image_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExtractionResult:
    candidate_id: str
    is_event: bool
    title: str | None = None
    event_date: datetime | None = None
    event_end_date: datetime | None = None
    location_name: str | None = None
    club_name: str | None = None
    vibes: tuple[str, ...] = ()
    raw: dict = field(default_factory=dict)


class Extractor(Protocol):
    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]: ...
