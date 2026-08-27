from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import AdminActor
from app.models.event import Event
from app.models.event_audit import EventAuditAction, EventAuditActor, EventAuditLog
from app.schemas.event import CreateEventRequest
from app.services import recommender
from app.services.ids import generate_unique_id


def event_snapshot(event: Event) -> dict:
    return {
        "title": event.title,
        "description": event.description,
        "source": event.source,
        "source_label": event.source_label,
        "source_url": event.source_url,
        "club_name": event.club_name,
        "vibes": event.vibes or [],
        "location_name": event.location_name,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "event_end_date": event.event_end_date.isoformat()
        if event.event_end_date
        else None,
        "is_archived": event.is_archived,
        "archived_at": event.archived_at.isoformat() if event.archived_at else None,
        "archived_by": str(event.archived_by) if event.archived_by else None,
    }


def add_event_audit(  # noqa: PLR0913
    session: AsyncSession,
    event: Event,
    actor: AdminActor | EventAuditActor,
    action: EventAuditAction,
    before: dict | None,
    after: dict | None,
) -> None:
    audit_actor = (
        actor
        if isinstance(actor, EventAuditActor)
        else EventAuditActor.authenticated(actor.actor_type, actor.actor_id)
    )
    session.add(
        EventAuditLog(
            event_id=event.id,
            actor_type=audit_actor.actor_type,
            actor_id=audit_actor.actor_id,
            action=action,
            before=before,
            after=after,
            created_at=datetime.now(UTC),
        )
    )


async def update_event_embedding(event: Event) -> None:
    embedding = await recommender.generate_event_embedding(event)
    if recommender.is_valid_embedding(embedding):
        event.embedding = embedding
        event.embedding_vector = embedding


async def create_canonical_event_listing(
    body: CreateEventRequest,
    actor: AdminActor | EventAuditActor,
    session: AsyncSession,
    *,
    explicit_id: str | None = None,
) -> Event:
    event_id = explicit_id or await generate_unique_id(session)
    event = Event(id=event_id, **body.model_dump())
    session.add(event)
    await session.flush()
    await update_event_embedding(event)
    add_event_audit(
        session, event, actor, EventAuditAction.CREATE, None, event_snapshot(event)
    )
    return event
