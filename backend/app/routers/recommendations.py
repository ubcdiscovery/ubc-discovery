from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.event import Event
from app.models.saved_event import SavedEvent
from app.models.user import User
from app.presenters.event import event_to_response
from app.schemas.recommendation import ForYouResponse, SimilarEventsResponse
from app.services import recommender

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


@router.get("/events/{event_id}/similar", response_model=SimilarEventsResponse)
async def get_similar_events(
    event_id: str,
    n: int = Query(default=5, ge=1, le=20),
    vibe_weight: float = Query(default=recommender.VIBE_WEIGHT_DEFAULT, ge=0.0, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Event).where(Event.id == event_id))
    source_event = result.scalar_one_or_none()
    if not source_event:
        raise HTTPException(status_code=404, detail="Event not found")

    result = await db.execute(
        select(Event)
        .where(Event.id != event_id)
        .order_by(Event.event_date.desc().nullslast())
    )
    candidates = list(result.scalars().all())

    similar = recommender.get_similar_events(
        source_event, candidates, top_n=n, vibe_weight=vibe_weight
    )

    return SimilarEventsResponse(
        event_id=event_id,
        events=[event_to_response(e) for e, _ in similar],
        scores=[round(s, 4) for _, s in similar],
    )


@router.get("/events/for-you", response_model=ForYouResponse)
async def get_for_you(
    n: int = Query(default=10, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    saved_result = await db.execute(
        select(SavedEvent)
        .where(SavedEvent.user_id == current_user.id)
        .order_by(SavedEvent.saved_at.desc())
        .limit(100)
    )
    saved_rows = list(saved_result.scalars().all())

    if saved_rows:
        saved_event_ids = [s.event_id for s in saved_rows]
        events_result = await db.execute(
            select(Event).where(Event.id.in_(saved_event_ids))
        )
        saved_events = list(events_result.scalars().all())

        saved_embeddings = [e.embedding for e in saved_events if e.embedding]
        taste = recommender.mean_embedding(saved_embeddings)

        saved_vibes: list[str] = []
        for e in saved_events:
            if e.vibes:
                saved_vibes.extend(e.vibes)
        vibe_counts: dict[str, int] = {}
        for v in saved_vibes:
            vibe_counts[v] = vibe_counts.get(v, 0) + 1
        top_saved_vibes = sorted(
            vibe_counts, key=lambda vibe: vibe_counts[vibe], reverse=True
        )[:3]

        user_interests: list[str] = (
            list(current_user.interests) if current_user.interests else []
        )
        combined_vibes = list(set(user_interests) | set(top_saved_vibes))

        if taste:
            candidates_result = await db.execute(
                select(Event)
                .where(Event.id.notin_(saved_event_ids))
                .order_by(Event.event_date.desc().nullslast())
                .limit(200)
            )
            candidates = list(candidates_result.scalars().all())

            ranked = recommender.rank_events(
                taste, candidates, top_n=n, vibe_profile=combined_vibes
            )

            if ranked:
                return ForYouResponse(
                    events=[event_to_response(e) for e, _ in ranked],
                    scores=[round(s, 4) for _, s in ranked],
                    source="saved_events",
                )

    recent_result = await db.execute(
        select(Event)
        .order_by(Event.event_date.desc().nullslast(), Event.created_at.desc())
        .limit(n)
    )
    recent = list(recent_result.scalars().all())

    return ForYouResponse(
        events=[event_to_response(e) for e in recent],
        scores=[0.0] * len(recent),
        source="recent",
    )
