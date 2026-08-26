from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import AdminActor, require_admin
from app.models.event import Event
from app.models.event_audit import EventAuditAction, EventAuditLog
from app.presenters.event import admin_event_to_response, event_image_key
from app.schemas.event import (
    AdminEventListResponse,
    AdminEventResponse,
    CreateEventRequest,
    EventAdminStatus,
    EventAuditListResponse,
    EventAuditResponse,
    UpdateEventRequest,
)
from app.schemas.user import PresignedUploadResponse
from app.services import s3
from app.services.event_administration import (
    add_event_audit,
    create_canonical_event_listing,
    event_snapshot,
    update_event_embedding,
)

router = APIRouter(
    prefix="/events",
    tags=["Admin Events"],
)


@router.get("", response_model=AdminEventListResponse)
async def list_admin_events(
    q: str = Query(default=""),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    status: EventAdminStatus = Query(default="all"),
    db: AsyncSession = Depends(get_db),
):
    term = q.strip()
    condition = None
    if term:
        pattern = f"%{term}%"
        condition = or_(
            Event.title.ilike(pattern),
            Event.description.ilike(pattern),
            Event.location_name.ilike(pattern),
            Event.club_name.ilike(pattern),
        )

    events_query = select(Event)
    count_query = select(func.count()).select_from(Event)
    if status == "active":
        events_query = events_query.where(Event.is_archived.is_(False))
        count_query = count_query.where(Event.is_archived.is_(False))
    elif status == "archived":
        events_query = events_query.where(Event.is_archived.is_(True))
        count_query = count_query.where(Event.is_archived.is_(True))
    if condition is not None:
        events_query = events_query.where(condition)
        count_query = count_query.where(condition)

    result = await db.execute(
        events_query.order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    total = await db.scalar(count_query)
    return AdminEventListResponse(
        events=[admin_event_to_response(event) for event in result.scalars().all()],
        total=total or 0,
    )


@router.get("/{event_id}/audit", response_model=EventAuditListResponse)
async def list_event_audit(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    event_result = await db.execute(select(Event.id).where(Event.id == event_id))
    if event_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Event not found")

    result = await db.execute(
        select(EventAuditLog)
        .where(EventAuditLog.event_id == event_id)
        .order_by(EventAuditLog.created_at.asc(), EventAuditLog.id.asc())
    )
    return EventAuditListResponse(
        entries=[
            EventAuditResponse.model_validate(entry) for entry in result.scalars().all()
        ]
    )


@router.get("/{event_id}", response_model=AdminEventResponse)
async def get_admin_event(event_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return admin_event_to_response(event)


@router.post("", response_model=AdminEventResponse)
async def create_event(
    body: CreateEventRequest,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    event = await create_canonical_event_listing(body, actor, db)
    await db.commit()
    await db.refresh(event)
    return admin_event_to_response(event)


@router.put("/{event_id}", response_model=AdminEventResponse)
async def update_event(
    event_id: str,
    body: UpdateEventRequest,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    changes = body.model_dump(exclude_unset=True)
    before = event_snapshot(event)
    next_start = changes.get("event_date", event.event_date)
    next_end = changes.get("event_end_date", event.event_end_date)
    if next_start and next_end and next_end < next_start:
        raise HTTPException(
            status_code=422, detail="event_end_date must not be before event_date"
        )

    embedding_fields = {
        "title",
        "description",
        "club_name",
        "vibes",
        "location_name",
        "event_date",
        "event_end_date",
    }
    should_update_embedding = any(
        field in embedding_fields and getattr(event, field) != value
        for field, value in changes.items()
    )

    for field, value in changes.items():
        setattr(event, field, value)

    if should_update_embedding:
        await update_event_embedding(event)

    if changes:
        add_event_audit(
            db, event, actor, EventAuditAction.UPDATE, before, event_snapshot(event)
        )
    await db.commit()
    await db.refresh(event)

    return admin_event_to_response(event)


async def _set_archive_state(
    event: Event,
    db: AsyncSession,
    actor: AdminActor,
    is_archived: bool,
) -> Event:
    if event.is_archived == is_archived:
        return event

    before = event_snapshot(event)
    event.is_archived = is_archived
    event.archived_at = datetime.now(UTC) if is_archived else None
    event.archived_by = actor.actor_id if is_archived else None
    add_event_audit(
        db,
        event,
        actor,
        EventAuditAction.ARCHIVE if is_archived else EventAuditAction.RESTORE,
        before,
        event_snapshot(event),
    )
    await db.commit()
    await db.refresh(event)
    return event


@router.post("/{event_id}/archive", response_model=AdminEventResponse)
async def archive_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return admin_event_to_response(await _set_archive_state(event, db, actor, True))


@router.post("/{event_id}/restore", response_model=AdminEventResponse)
async def restore_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return admin_event_to_response(await _set_archive_state(event, db, actor, False))


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    await _set_archive_state(event, db, actor, True)
    return Response(status_code=204)


@router.post(
    "/{event_id}/presigned-upload",
    response_model=PresignedUploadResponse,
)
async def get_event_presigned_upload(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    url, fields, file_key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key=event_image_key(event_id),
        max_file_size_bytes=settings.event_image_max_bytes,
    )
    add_event_audit(
        db,
        event,
        actor,
        EventAuditAction.IMAGE_UPLOAD,
        None,
        {"event_picture_key": file_key},
    )
    await db.commit()
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        file_key=file_key,
        max_file_size_bytes=settings.event_image_max_bytes,
    )
