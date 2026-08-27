from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Float, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event import Event
from app.models.event_rating import EventRating
from app.presenters.event import event_to_past_response, event_to_response
from app.schemas.event import EventListResponse, EventResponse, PastEventListResponse

router = APIRouter(prefix="/events", tags=["Events"])


@router.get("", response_model=EventListResponse)
async def list_events(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
):
    current_time = datetime.now(ZoneInfo("America/Vancouver"))
    result = await db.execute(
        select(Event)
        .where(Event.event_date >= current_time, Event.is_archived.is_(False))
        .order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    events = result.scalars().all()
    return EventListResponse(events=[event_to_response(e) for e in events])


@router.get("/past", response_model=PastEventListResponse)
async def list_past_events(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, le=100),
    db: AsyncSession = Depends(get_db),
):
    current_time = datetime.now(ZoneInfo("America/Vancouver"))
    result = await db.execute(
        select(
            Event,
            func.avg(EventRating.stars).cast(Float),
            func.count(EventRating.stars),
        )
        .outerjoin(EventRating, Event.id == EventRating.event_id)
        .where(Event.event_date < current_time, Event.is_archived.is_(False))
        .group_by(Event.id)
        .order_by(Event.event_date.desc(), Event.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    events = result.all()
    return PastEventListResponse(
        events=[event_to_past_response(e, avg, count) for e, avg, count in events]
    )


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
            Event.is_archived.is_(False),
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
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_archived.is_(False))
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event_to_response(event)
