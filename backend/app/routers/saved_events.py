from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.event import Event
from app.models.saved_event import SavedEvent
from app.models.user import User
from app.presenters.event import event_to_response
from app.schemas.saved_event import (
    SavedEventListItem,
    SavedEventListResponse,
    SavedEventResponse,
)

router = APIRouter(prefix="/saved-events", tags=["Saved Events"])


@router.get("", response_model=SavedEventListResponse)
async def list_saved_events(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_result = await db.execute(
        select(func.count())
        .select_from(SavedEvent)
        .where(SavedEvent.user_id == user.id)
    )
    total = count_result.scalar_one()

    result = await db.execute(
        select(SavedEvent, Event)
        .join(Event, Event.id == SavedEvent.event_id)
        .where(SavedEvent.user_id == user.id)
        .order_by(SavedEvent.saved_at.desc())
        .offset(skip)
        .limit(limit)
    )
    saved = result.all()
    return SavedEventListResponse(
        saved_events=[
            SavedEventListItem(
                saved_at=saved_event.saved_at,
                event=event_to_response(event),
            )
            for saved_event, event in saved
        ],
        total=total,
    )


@router.put(
    "/{event_id}",
    response_model=SavedEventResponse,
    status_code=status.HTTP_201_CREATED,
    responses={status.HTTP_200_OK: {"model": SavedEventResponse}},
)
async def save_event(
    event_id: str,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify event exists
    event_result = await db.execute(select(Event).where(Event.id == event_id))
    if not event_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    result = await db.execute(
        insert(SavedEvent)
        .values(user_id=user.id, event_id=event_id)
        .on_conflict_do_nothing(
            index_elements=[SavedEvent.user_id, SavedEvent.event_id]
        )
        .returning(SavedEvent)
    )
    saved_event = result.scalar_one_or_none()

    if saved_event is None:
        response.status_code = status.HTTP_200_OK
        existing_result = await db.execute(
            select(SavedEvent).where(
                SavedEvent.user_id == user.id,
                SavedEvent.event_id == event_id,
            )
        )
        saved_event = existing_result.scalar_one()
    else:
        response.headers["Location"] = f"/saved-events/{event_id}"

    await db.commit()
    return SavedEventResponse(
        event_id=saved_event.event_id,
        saved_at=saved_event.saved_at,
    )


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_event(
    event_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        delete(SavedEvent).where(
            SavedEvent.user_id == user.id,
            SavedEvent.event_id == event_id,
        )
    )
    await db.commit()
