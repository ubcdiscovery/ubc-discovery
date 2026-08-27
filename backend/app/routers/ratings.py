from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.event import Event
from app.models.event_rating import EventRating
from app.models.user import User
from app.schemas.event_rating import (
    CreateRatingRequest,
    EventRatingResponse,
    RatingListResponse,
)

router = APIRouter(prefix="/ratings", tags=["Ratings"])


def _to_response(r: EventRating, user_name: str) -> EventRatingResponse:
    return EventRatingResponse.model_validate(
        {**{k: v for k, v in vars(r).items() if not k.startswith("_")}, "user_name": user_name}
    )

@router.get("", response_model=RatingListResponse)
async def list_ratings(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(
        select(func.count())
        .select_from(EventRating)
        .join(Event, Event.id == EventRating.event_id)
        .where(EventRating.user_id == user.id, Event.is_archived.is_(False))
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(EventRating)
        .join(Event, Event.id == EventRating.event_id)
        .where(EventRating.user_id == user.id, Event.is_archived.is_(False))
        .order_by(EventRating.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    ratings = result.scalars().all()
    return RatingListResponse(
        ratings=[_to_response(r, user.preferred_name) for r in ratings],
        total=total,
    )


@router.post("/mine/{event_id}", response_model=EventRatingResponse)
async def rate_event(
    event_id: str,
    body: CreateRatingRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    event_result = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_archived.is_(False))
    )
    if not event_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Event with give id NOT found")

    existing_result = await db.execute(
        select(EventRating).where(
            and_(EventRating.user_id == user.id, EventRating.event_id == event_id)
        )
    )
    existing = existing_result.scalar_one_or_none()

    if existing:
        existing.stars = body.stars
        existing.strong_vibes = body.strong_vibes
        existing.note = body.note
        await db.commit()
        await db.refresh(existing)
        return _to_response(existing, user.preferred_name)

    rating = EventRating(
        user_id=user.id,
        event_id=event_id,
        stars=body.stars,
        strong_vibes=body.strong_vibes,
        note=body.note,
    )
    db.add(rating)
    await db.commit()
    await db.refresh(rating)
    return _to_response(rating, user.preferred_name)


@router.get("/mine/{event_id}", response_model=EventRatingResponse)
async def get_rating(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EventRating)
        .join(Event, Event.id == EventRating.event_id)
        .where(
            and_(
                EventRating.user_id == user.id,
                EventRating.event_id == event_id,
                Event.is_archived.is_(False),
            )
        )
    )
    rating = result.scalar_one_or_none()
    if not rating:
        raise HTTPException(status_code=404, detail="Rating not found")
    return _to_response(rating, user.preferred_name)


@router.get("/{event_id}", response_model=list[EventRatingResponse])
async def get_event_ratings(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EventRating, User.preferred_name)
        .join(Event, Event.id == EventRating.event_id)
        .join(User, User.id == EventRating.user_id)
        .where(
            and_(
                EventRating.event_id == event_id,
                Event.is_archived.is_(False),
            )
        )
        .order_by(EventRating.created_at.desc())
    )
    return [_to_response(r, username) for r, username in result.all()]
