from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import AdminActor, require_admin
from app.models.event import Event
from app.models.event_listing_candidate import (
    CandidateStatus,
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.presenters.candidate import admin_candidate_to_response
from app.schemas.event_listing_candidate import (
    AdminCandidateListQuery,
    AdminEventListingCandidateListResponse,
    CandidateMatchResponse,
    CorrectCandidateRequest,
    EventListingCandidateDetailResponse,
)
from app.services.candidate_publication import (
    publish_candidate,
    same_club_same_day_candidates,
    same_club_same_day_events,
)

router = APIRouter(prefix="/candidates", tags=["Admin Candidates"])


async def _same_club_same_day_matches(
    candidate: EventListingCandidate, db: AsyncSession
) -> list[CandidateMatchResponse]:
    candidate_matches = [
        CandidateMatchResponse(
            kind="candidate",
            id=item.id,
            title=item.title or item.description,
            event_date=item.event_date,
        )
        for item in await same_club_same_day_candidates(candidate, db)
        if item.event_date is not None
    ]
    return sorted(
        candidate_matches
        + [
            CandidateMatchResponse(
                kind="event", id=item.id, title=item.title, event_date=item.event_date
            )
            for item in await same_club_same_day_events(candidate, db)
        ],
        key=lambda item: (item.event_date.isoformat(), item.kind, item.id, item.title),
    )


async def _detail(
    candidate: EventListingCandidate, db: AsyncSession
) -> EventListingCandidateDetailResponse:
    audits = await db.scalars(
        select(EventListingCandidateIngestionAudit)
        .where(EventListingCandidateIngestionAudit.candidate_id == candidate.id)
        .order_by(EventListingCandidateIngestionAudit.received_at.desc())
    )
    return EventListingCandidateDetailResponse(
        **admin_candidate_to_response(candidate).model_dump(),
        ingestion_audits=audits.all(),
        same_club_same_day_matches=await _same_club_same_day_matches(candidate, db),
    )


async def _locked_candidate(
    candidate_id: str, db: AsyncSession
) -> EventListingCandidate:
    candidate = await db.scalar(
        select(EventListingCandidate)
        .where(EventListingCandidate.id == candidate_id)
        .with_for_update()
    )
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return candidate


def _require_pending(candidate: EventListingCandidate, action: str) -> None:
    if candidate.status != CandidateStatus.PENDING:
        raise HTTPException(
            status_code=409, detail=f"Only pending Candidates can be {action}"
        )


def _require_rejected(candidate: EventListingCandidate) -> None:
    if candidate.status != CandidateStatus.REJECTED:
        raise HTTPException(
            status_code=409, detail="Only rejected Candidates can return to review"
        )


@router.get("", response_model=AdminEventListingCandidateListResponse)
async def list_admin_candidates(
    filters: Annotated[AdminCandidateListQuery, Query()],
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    if filters.q:
        pattern = f"%{filters.q}%"
        conditions.append(
            or_(
                EventListingCandidate.description.ilike(pattern),
                EventListingCandidate.source_account.ilike(pattern),
                EventListingCandidate.source_type.ilike(pattern),
                EventListingCandidate.external_source_id.ilike(pattern),
            )
        )
    if filters.status is not None:
        conditions.append(EventListingCandidate.status == filters.status)
    if filters.source_type is not None:
        conditions.append(EventListingCandidate.source_type == filters.source_type)
    query = select(EventListingCandidate)
    count = select(func.count()).select_from(EventListingCandidate)
    if conditions:
        query = query.where(*conditions)
        count = count.where(*conditions)
    result = await db.execute(
        query.order_by(
            EventListingCandidate.created_at.desc(), EventListingCandidate.id.desc()
        )
        .offset(filters.skip)
        .limit(filters.limit)
    )
    return AdminEventListingCandidateListResponse(
        candidates=[
            admin_candidate_to_response(item) for item in result.scalars().all()
        ],
        total=int(await db.scalar(count) or 0),
    )


@router.get("/{candidate_id}", response_model=EventListingCandidateDetailResponse)
async def get_admin_candidate(candidate_id: str, db: AsyncSession = Depends(get_db)):
    candidate = await db.get(EventListingCandidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return await _detail(candidate, db)


@router.put("/{candidate_id}", response_model=EventListingCandidateDetailResponse)
async def correct_candidate(
    candidate_id: str,
    body: CorrectCandidateRequest,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    candidate = await _locked_candidate(candidate_id, db)
    _require_pending(candidate, "corrected")
    changes = body.model_dump(exclude_unset=True)
    next_start = changes.get("event_date", candidate.event_date)
    next_end = changes.get("event_end_date", candidate.event_end_date)
    if next_start is not None and next_end is not None and next_end < next_start:
        raise HTTPException(
            status_code=422, detail="event_end_date must be on or after event_date"
        )
    for field, value in changes.items():
        setattr(candidate, field, value)
    await db.commit()
    await db.refresh(candidate)
    return await _detail(candidate, db)


@router.post(
    "/{candidate_id}/approve", response_model=EventListingCandidateDetailResponse
)
async def approve_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    candidate = await _locked_candidate(candidate_id, db)
    if candidate.status == CandidateStatus.APPROVED:
        if await db.get(Event, candidate.id) is None:
            raise HTTPException(
                status_code=409,
                detail="Approved Candidate has no matching Event Listing",
            )
        return await _detail(candidate, db)
    _require_pending(candidate, "approved")
    if candidate.is_event is not True:
        raise HTTPException(
            status_code=422, detail="Candidate must be classified as an event"
        )
    if await db.get(Event, candidate.id) is not None:
        raise HTTPException(
            status_code=409, detail="An Event Listing already uses this Candidate id"
        )
    try:
        await publish_candidate(db, candidate, actor)
        await db.commit()
    except ValidationError as exc:
        await db.rollback()
        detail = [
            {
                "type": error.get("type"),
                "loc": list(error.get("loc", ())),
                "msg": error.get("msg"),
            }
            for error in exc.errors()
        ]
        raise HTTPException(status_code=422, detail=detail) from exc
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="An Event Listing already uses this Candidate id"
        ) from exc
    except Exception:
        await db.rollback()
        raise
    await db.refresh(candidate)
    return await _detail(candidate, db)


@router.post(
    "/{candidate_id}/reject", response_model=EventListingCandidateDetailResponse
)
async def reject_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    candidate = await _locked_candidate(candidate_id, db)
    _require_pending(candidate, "rejected")
    candidate.status = CandidateStatus.REJECTED
    await db.commit()
    await db.refresh(candidate)
    return await _detail(candidate, db)


@router.post(
    "/{candidate_id}/return-to-review",
    response_model=EventListingCandidateDetailResponse,
)
async def return_candidate_to_review(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    actor: AdminActor = Depends(require_admin),
):
    candidate = await _locked_candidate(candidate_id, db)
    _require_rejected(candidate)
    candidate.status = CandidateStatus.PENDING
    await db.commit()
    await db.refresh(candidate)
    return await _detail(candidate, db)
