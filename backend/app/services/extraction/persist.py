from __future__ import annotations

from datetime import datetime

from app.models.event_listing_candidate import EventListingCandidate
from app.schemas.event import EVENT_SOURCE_LABELS, EVENT_VIBES
from app.services.extraction.types import ExtractionResult


def persist_extraction(
    candidate: EventListingCandidate,
    result: ExtractionResult,
    *,
    model: str,
    extracted_at: datetime,
) -> None:
    if candidate.extracted_at is not None:
        return

    candidate.extracted_original = result.raw or {
        "is_event": result.is_event,
        "title": result.title,
        "event_date": result.event_date.isoformat() if result.event_date else None,
        "event_end_date": (
            result.event_end_date.isoformat() if result.event_end_date else None
        ),
        "location_name": result.location_name,
        "club_name": result.club_name,
        "vibes": list(result.vibes),
        "source_label": result.source_label,
    }
    candidate.extraction_model = model
    candidate.extracted_at = extracted_at
    candidate.is_event = result.is_event
    if not result.is_event:
        candidate.title = None
        candidate.location_name = None
        candidate.event_date = None
        candidate.event_end_date = None
        candidate.club_name = None
        candidate.vibes = []
        candidate.source_label = None
        return

    vibes = [vibe for vibe in result.vibes if vibe in EVENT_VIBES]
    source_label = (
        result.source_label if result.source_label in EVENT_SOURCE_LABELS else None
    )
    candidate.title = result.title
    candidate.location_name = result.location_name
    candidate.event_date = result.event_date
    candidate.event_end_date = result.event_end_date
    candidate.club_name = result.club_name
    candidate.vibes = vibes
    candidate.source_label = source_label
