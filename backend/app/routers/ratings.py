from datetime import UTC, datetime

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
        {
            **{k: v for k, v in vars(r).items() if not k.startswith("_")},
            "user_name": user_name,
        }
    )


# 404ERR: no Event exists with event_id
# 400ERR: event can not be rated at this time
async def _verify_event(event_id: str, db: AsyncSession):
    event_result = await db.execute(
        select(Event).where(Event.id == event_id, Event.is_archived.is_(False))
    )
    event = event_result.scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="Event with give id NOT found")

    if not event.event_end_date or event.event_end_date > datetime.now(UTC):
        raise HTTPException(
            status_code=400, detail="Event can not be rated at this time"
        )


# USE: Retrieve ALL ratings current user has made
# RETURNS: body with list of ratings
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


# USE: Update or add rating current user has made for given event_id
#      If a rating existed, will update it. Otherwise creates a new one in the db
# 404ERR: no Event exists with event_id
# 400ERR: event can not be rated at this time
# RETURNS: the new/updated rating
@router.post("/mine/{event_id}", response_model=EventRatingResponse)
async def rate_event(
    event_id: str,
    body: CreateRatingRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_event(event_id, db)

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


# USE: Retrieve rating current user has made for given event_id
# 404ERR: no Event exists with event_id
# 400ERR: event can not be rated at this time
# RETURNS: the rating or nil if no rating made
@router.get("/mine/{event_id}", response_model=EventRatingResponse)
async def get_rating(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _verify_event(event_id, db)

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


# USE: Retrieve all ratings made for a given event_id
# 404ERR: no Event exists with event_id
# 400ERR: event can not be rated at this time
# RETURNS: the rating or nil if no rating made
@router.get("/{event_id}", response_model=list[EventRatingResponse])
async def get_event_ratings(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    await _verify_event(event_id, db)

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
