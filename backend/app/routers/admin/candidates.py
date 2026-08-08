import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event_listing_candidate import (
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.schemas.event_listing_candidate import (
    AdminEventListingCandidateListResponse,
    CandidateStatus,
    EventListingCandidateDetailResponse,
    EventListingCandidateResponse,
)

router = APIRouter(
    prefix="/candidates",
    tags=["Admin Candidates"],
)


@router.get("", response_model=AdminEventListingCandidateListResponse)
async def list_admin_candidates(  # noqa: PLR0913
    q: str = Query(default=""),
    status: CandidateStatus | None = Query(default=None),
    source_type: str | None = Query(default=None, min_length=1, max_length=50),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    conditions = []
    term = q.strip()
    if term:
        pattern = f"%{term}%"
        conditions.append(
            or_(
                EventListingCandidate.title.ilike(pattern),
                EventListingCandidate.club_name.ilike(pattern),
                EventListingCandidate.location_name.ilike(pattern),
                EventListingCandidate.source_type.ilike(pattern),
                EventListingCandidate.external_source_id.ilike(pattern),
            )
        )
    if status is not None:
        conditions.append(EventListingCandidate.status == status)
    if source_type is not None:
        conditions.append(EventListingCandidate.source_type == source_type)

    events_query = select(EventListingCandidate)
    count_query = select(func.count()).select_from(EventListingCandidate)
    if conditions:
        events_query = events_query.where(*conditions)
        count_query = count_query.where(*conditions)

    result = await db.execute(
        events_query
        .order_by(
            EventListingCandidate.created_at.desc(),
            EventListingCandidate.id.desc(),
        )
        .offset(skip)
        .limit(limit)
    )
    total = await db.scalar(count_query)
    return AdminEventListingCandidateListResponse(
        candidates=[
            EventListingCandidateResponse.model_validate(candidate)
            for candidate in result.scalars().all()
        ],
        total=total or 0,
    )


@router.get("/{candidate_id}", response_model=EventListingCandidateDetailResponse)
async def get_admin_candidate(
    candidate_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    candidate = await db.get(EventListingCandidate, candidate_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    audits_result = await db.execute(
        select(EventListingCandidateIngestionAudit)
        .where(EventListingCandidateIngestionAudit.candidate_id == candidate_id)
        .order_by(EventListingCandidateIngestionAudit.received_at.desc())
    )
    return EventListingCandidateDetailResponse(
        **EventListingCandidateResponse.model_validate(candidate).model_dump(),
        ingestion_audits=audits_result.scalars().all(),
    )
