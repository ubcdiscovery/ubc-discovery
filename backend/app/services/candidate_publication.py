"""Shared Candidate publication path and automatic publication eligibility."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
from enum import StrEnum
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminActor
from app.models.audit_actor import AuditActorType
from app.models.event import Event, EventSourceLabel
from app.models.event_listing_candidate import (
    CandidateStatus,
    EventListingCandidate,
)
from app.presenters.event import event_image_key
from app.schemas.event import CreateEventRequest
from app.services import s3
from app.services.event_administration import create_canonical_event_listing

VANCOUVER = ZoneInfo("America/Vancouver")

# Automated publication writes audit entries under this actor.
SYSTEM_ACTOR = AdminActor(actor_type=AuditActorType.SYSTEM, actor_id=uuid.UUID(int=0))


class AutoPublicationOutcome(StrEnum):
    PUBLISHED = "published"
    REJECTED = "rejected"
    PENDING = "pending"


def _coerce_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _local_bounds(value: datetime) -> tuple[datetime, datetime]:
    local_date = _coerce_utc(value).astimezone(VANCOUVER).date()
    start = datetime.combine(local_date, time.min, tzinfo=VANCOUVER)
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)


def has_started(event_date: datetime | None, *, now: datetime) -> bool:
    """Return whether an event's start is already in the past."""
    return event_date is not None and _coerce_utc(event_date) < now


def is_complete(candidate: EventListingCandidate) -> bool:
    """A Candidate is complete when extraction marked it an event and title,
    event_date, and location text are present."""
    return (
        candidate.is_event is True
        and bool((candidate.title or "").strip())
        and candidate.event_date is not None
        and bool((candidate.location_name or "").strip())
    )


def event_request(candidate: EventListingCandidate) -> CreateEventRequest:
    return CreateEventRequest.model_validate(
        {
            "title": candidate.title,
            "description": candidate.description,
            "source": candidate.source_type,
            "source_label": candidate.source_label,
            "source_url": candidate.source_url,
            "club_name": candidate.club_name,
            "vibes": candidate.vibes or [],
            "location_name": candidate.location_name,
            "event_date": candidate.event_date,
            "event_end_date": candidate.event_end_date,
        }
    )


async def same_club_same_day_candidates(
    candidate: EventListingCandidate, db: AsyncSession
) -> list[EventListingCandidate]:
    if not candidate.club_name or not candidate.event_date:
        return []
    club = candidate.club_name.strip().lower()
    if not club:
        return []
    start, end = _local_bounds(candidate.event_date)
    return list(
        (
            await db.scalars(
                select(EventListingCandidate)
                .where(
                    EventListingCandidate.status == CandidateStatus.PENDING,
                    EventListingCandidate.id != candidate.id,
                    EventListingCandidate.club_name.is_not(None),
                    func.lower(func.trim(EventListingCandidate.club_name)) == club,
                    EventListingCandidate.event_date >= start,
                    EventListingCandidate.event_date < end,
                )
                .order_by(
                    EventListingCandidate.event_date.asc(),
                    EventListingCandidate.id.asc(),
                )
            )
        ).all()
    )


async def same_club_same_day_events(
    candidate: EventListingCandidate, db: AsyncSession
) -> list[Event]:
    if not candidate.club_name or not candidate.event_date:
        return []
    club = candidate.club_name.strip().lower()
    if not club:
        return []
    start, end = _local_bounds(candidate.event_date)
    return list(
        (
            await db.scalars(
                select(Event)
                .where(
                    Event.is_archived.is_(False),
                    Event.id != candidate.id,
                    Event.club_name.is_not(None),
                    func.lower(func.trim(Event.club_name)) == club,
                    Event.event_date >= start,
                    Event.event_date < end,
                )
                .order_by(Event.event_date.asc(), Event.id.asc())
            )
        ).all()
    )


async def same_club_same_day_exists(
    candidate: EventListingCandidate, db: AsyncSession
) -> bool:
    return bool(
        await same_club_same_day_candidates(candidate, db)
        or await same_club_same_day_events(candidate, db)
    )


async def publish_candidate(
    db: AsyncSession, candidate: EventListingCandidate, actor: AdminActor
) -> None:
    """Publish a decided Candidate through the authoritative Event Listing
    validation, embedding, image, and audit path and mark it approved.

    The caller is responsible for the pending check and id-collision guard;
    raises ValidationError or IntegrityError so HTTP callers can map them.
    """
    await create_canonical_event_listing(
        event_request(candidate), actor, db, explicit_id=candidate.id
    )
    if candidate.image_keys:
        s3.copy_object(candidate.image_keys[0], event_image_key(candidate.id))
    candidate.status = CandidateStatus.APPROVED


async def process_auto_publication(
    db: AsyncSession,
    candidate: EventListingCandidate,
    *,
    now: datetime | None = None,
) -> AutoPublicationOutcome:
    """Apply the automatic publication decision to one pending Candidate.

    Complete Candidates publish unless they are Campus Community, their event
    already started, or a same-club same-day hold applies. Stale non-Campus
    Community Candidates are rejected; every other hold stays pending.
    Idempotent: approved Candidates and claimed ids are left untouched.
    """
    moment = now or datetime.now(UTC)
    locked = await db.scalar(
        select(EventListingCandidate)
        .where(EventListingCandidate.id == candidate.id)
        .with_for_update()
    )
    if locked is None or locked.status != CandidateStatus.PENDING:
        return AutoPublicationOutcome.PENDING
    if not is_complete(locked):
        return AutoPublicationOutcome.PENDING
    if locked.source_label == EventSourceLabel.CAMPUS_COMMUNITY:
        return AutoPublicationOutcome.PENDING
    if has_started(locked.event_date, now=moment):
        locked.status = CandidateStatus.REJECTED
        return AutoPublicationOutcome.REJECTED
    if await same_club_same_day_exists(locked, db):
        return AutoPublicationOutcome.PENDING
    if await db.get(Event, locked.id) is not None:
        return AutoPublicationOutcome.PENDING
    await publish_candidate(db, locked, SYSTEM_ACTOR)
    return AutoPublicationOutcome.PUBLISHED
