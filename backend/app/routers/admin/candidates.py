import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.event_listing_candidate import (
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.schemas.event_listing_candidate import (
    AdminCandidateListQuery,
    AdminEventListingCandidateListResponse,
    EventListingCandidateDetailResponse,
    EventListingCandidateResponse,
)

router = APIRouter(
    prefix="/candidates",
    tags=["Admin Candidates"],
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

    candidates_query = select(EventListingCandidate)
    count_query = select(func.count()).select_from(EventListingCandidate)
    if conditions:
        candidates_query = candidates_query.where(*conditions)
        count_query = count_query.where(*conditions)

    result = await db.execute(
        candidates_query.order_by(
            EventListingCandidate.created_at.desc(),
            EventListingCandidate.id.desc(),
        )
        .offset(filters.skip)
        .limit(filters.limit)
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
