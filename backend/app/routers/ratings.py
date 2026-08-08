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
        .where(EventRating.user_id == user.id)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(EventRating)
        .where(EventRating.user_id == user.id)
        .order_by(EventRating.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    ratings = result.scalars().all()
    return RatingListResponse(
        ratings=[EventRatingResponse.model_validate(r) for r in ratings],
        total=total,
    )


@router.post("/{event_id}", response_model=EventRatingResponse)
async def rate_event(
    event_id: str,
    body: CreateRatingRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify event exists
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    if not event_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Event not found")

    # Upsert: update if already rated
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
        return EventRatingResponse.model_validate(existing)

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
    return EventRatingResponse.model_validate(rating)


@router.get("/{event_id}", response_model=EventRatingResponse)
async def get_rating(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EventRating).where(
            and_(EventRating.user_id == user.id, EventRating.event_id == event_id)
        )
    )
    rating = result.scalar_one_or_none()
    if not rating:
        raise HTTPException(status_code=404, detail="Rating not found")
    return EventRatingResponse.model_validate(rating)
