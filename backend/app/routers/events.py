from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from zoneinfo import ZoneInfo

from app.config import settings
from app.database import get_db
from app.dependencies import require_admin
from app.models.event import Event
from app.presenters.event import event_image_key, event_to_response
from app.schemas.event import (
    CreateEventRequest,
    EventListResponse,
    EventResponse,
    UpdateEventRequest,
)
from app.schemas.user import PresignedUploadResponse
from app.services import recommender
from app.services import s3

router = APIRouter(prefix="/events", tags=["Events"])


async def _update_embedding(event: Event, db: AsyncSession) -> None:
    embedding = await recommender.generate_event_embedding(event)
    if embedding is not None:
        event.embedding = embedding
        await db.commit()


@router.get("", response_model=EventListResponse)
async def list_events(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
):
    current_time = datetime.now(ZoneInfo("America/Vancouver"))
    result = await db.execute(
        select(Event)
        .where(Event.event_date >= current_time)
        .order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    events = result.scalars().all()
    return EventListResponse(events=[event_to_response(e) for e in events])


@router.get("/search", response_model=EventListResponse)
async def search_events(
    q: str = Query(default=""),
    limit: int = Query(default=10, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Search events by title, description, location, or club name."""
    term = q.strip()
    if len(term) < 2:
        return EventListResponse(events=[])
    pattern = f"%{term}%"
    current_time = datetime.now(ZoneInfo("America/Vancouver"))
    query = (
        select(Event)
        .where(
            Event.event_date >= current_time,
            or_(
                Event.title.ilike(pattern),
                Event.description.ilike(pattern),
                Event.location_name.ilike(pattern),
                Event.club_name.ilike(pattern),
            ),
        )
        .order_by(Event.event_date.asc())
        .limit(limit)
    )
    result = await db.execute(query)
    events = result.scalars().all()
    return EventListResponse(events=[event_to_response(e) for e in events])


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event_to_response(event)


@router.post("", response_model=EventResponse, dependencies=[Depends(require_admin)])
async def create_event(
    body: CreateEventRequest,
    db: AsyncSession = Depends(get_db),
):
    event = Event(**body.model_dump())
    db.add(event)
    await db.commit()
    await db.refresh(event)

    # Generate embedding asynchronously after creation (~ Estimated Cost: 0.0001$ per event creation)
    await _update_embedding(event, db)

    return event_to_response(event)


@router.put(
    "/{event_id}", response_model=EventResponse, dependencies=[Depends(require_admin)]
)
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
    should_update_embedding = any(field in changes for field in embedding_fields)

    for field, value in changes.items():
        setattr(event, field, value)

    await db.commit()
    await db.refresh(event)

    if should_update_embedding:
        await _update_embedding(event, db)
        await db.refresh(event)

    return event_to_response(event)


@router.delete("/{event_id}", status_code=204, dependencies=[Depends(require_admin)])
async def delete_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    if event.event_picture_key:
        s3.delete_object(event.event_picture_key)
    await db.delete(event)
    await db.commit()


@router.post(
    "/{event_id}/presigned-upload",
    response_model=PresignedUploadResponse,
    dependencies=[Depends(require_admin)],
)
async def get_event_presigned_upload(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    content_type = "image/webp"

    result = await db.execute(select(Event).where(Event.id == event_id))
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    url, fields, file_key = s3.generate_presigned_upload_url(
        content_type=content_type,
        file_key=event_image_key(event_id),
        max_file_size_bytes=settings.event_image_max_bytes,
    )
    event.event_picture_key = file_key
    await db.commit()
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        file_key=file_key,
        max_file_size_bytes=settings.event_image_max_bytes,
    )
