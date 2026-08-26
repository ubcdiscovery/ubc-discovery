from nanoid import generate
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.event_listing_candidate import EventListingCandidate

EVENT_LISTING_ID_LOCK_KEY = 70000070


async def generate_unique_id(session: AsyncSession) -> str:
    """Return an eight-character id unused by either id-sharing table.

    The transaction-scoped lock serializes allocation and the caller's insert
    across both tables without adding a synthetic cross-table schema object.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(:lock_key)"),
        {"lock_key": EVENT_LISTING_ID_LOCK_KEY},
    )
    for _ in range(100):
        value = generate(size=8)
        candidate_exists = await session.scalar(
            select(EventListingCandidate.id).where(EventListingCandidate.id == value)
        )
        event_exists = await session.scalar(select(Event.id).where(Event.id == value))
        if candidate_exists is None and event_exists is None:
            return value
    raise RuntimeError("Could not allocate a unique Event Listing id")
