from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.event import Event
from app.presenters.event import event_image_key, event_to_response
from app.schemas.event import (
    AdminEventListResponse,
    CreateEventRequest,
    EventResponse,
    UpdateEventRequest,
)
from app.schemas.user import PresignedUploadResponse
from app.services import recommender, s3

router = APIRouter(
    prefix="/events",
    tags=["Admin Events"],
)


async def _update_embedding(event: Event, db: AsyncSession) -> None:
    embedding = await recommender.generate_event_embedding(event)
    if embedding is not None:
        event.embedding = embedding
        await db.commit()


@router.get("", response_model=AdminEventListResponse)
async def list_admin_events(
    q: str = Query(default=""),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
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
    if condition is not None:
        events_query = events_query.where(condition)
        count_query = count_query.where(condition)

    result = await db.execute(
        events_query
        .order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    total = await db.scalar(count_query)
    return AdminEventListResponse(
        events=[event_to_response(event) for event in result.scalars().all()],
        total=total or 0,
    )


@router.get("/{event_id}", response_model=EventResponse)
async def get_admin_event(event_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event_to_response(event)


@router.post("", response_model=EventResponse)
async def create_event(
    body: CreateEventRequest,
    db: AsyncSession = Depends(get_db),
):
    event = Event(**body.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)

    await _update_embedding(event, db)
    return event_to_response(event)


@router.put("/{event_id}", response_model=EventResponse)
async def update_event(
    event_id: str,
    body: UpdateEventRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    changes = body.model_dump(exclude_unset=True)
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

    await db.commit()
    await db.refresh(event)

    if should_update_embedding:
        await _update_embedding(event, db)
        await db.refresh(event)

    return event_to_response(event)


@router.delete("/{event_id}", status_code=204)
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    s3.delete_object(event_image_key(event.id))
    await db.delete(event)
    await db.commit()


@router.post(
    "/{event_id}/presigned-upload",
    response_model=PresignedUploadResponse,
)
async def get_event_presigned_upload(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Event not found")

    url, fields, file_key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key=event_image_key(event_id),
        max_file_size_bytes=settings.event_image_max_bytes,
    )
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        file_key=file_key,
        max_file_size_bytes=settings.event_image_max_bytes,
    )
