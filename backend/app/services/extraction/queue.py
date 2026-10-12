"""Queue delivery integration; PostgreSQL stores product progress, not retries."""

from datetime import UTC, datetime

import httpx

from app.config import settings
from app.models.event_listing_candidate import EventListingCandidate
from app.schemas.extraction import Delivery


def capture_timed_out(candidate: EventListingCandidate, now: datetime) -> bool:
    created = candidate.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return (now - created).total_seconds() >= settings.extraction_image_wait_seconds


async def dispatch_candidates(candidates: list[Delivery]) -> bool:
    if (
        not settings.extraction_queue_producer_url
        or not settings.extraction_queue_producer_secret
    ):
        return False
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            settings.extraction_queue_producer_url,
            headers={
                "Authorization": f"Bearer {settings.extraction_queue_producer_secret}"
            },
            json={"candidates": [item.model_dump() for item in candidates]},
        )
        response.raise_for_status()
    return True
