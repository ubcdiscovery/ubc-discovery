from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import (
    CandidateIngestionCredential,
    require_candidate_ingester,
)
from app.models.event_listing_candidate import (
    CandidateIngestionOutcome,
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.schemas.event_listing_candidate import (
    EventListingCandidateIngestionRequest,
    EventListingCandidateIngestionResponse,
    EventListingCandidateResponse,
)

router = APIRouter(prefix="/event-candidates", tags=["Candidate Ingestion"])


def _extraction_output(body: EventListingCandidateIngestionRequest) -> dict:
    return {
        "title": body.title,
        "description": body.description,
        "club_name": body.club_name,
        "source_url": body.source_url,
        "vibes": body.vibes,
        "location_name": body.location_name,
        "event_date": body.event_date.isoformat() if body.event_date else None,
        "event_end_date": (
            body.event_end_date.isoformat() if body.event_end_date else None
        ),
    }


@router.post(
    "",
    response_model=EventListingCandidateIngestionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def ingest_event_listing_candidate(
    body: EventListingCandidateIngestionRequest,
    response: Response,
    credential: CandidateIngestionCredential = Depends(require_candidate_ingester),
    db: AsyncSession = Depends(get_db),
):
    values = {
        **body.model_dump(),
        "extraction_output": _extraction_output(body),
    }
    inserted = await db.execute(
        insert(EventListingCandidate)
        .values(values)
        .on_conflict_do_nothing(
            index_elements=[
                EventListingCandidate.source_type,
                EventListingCandidate.external_source_id,
            ]
        )
        .returning(EventListingCandidate.id)
    )
    candidate_id = inserted.scalar_one_or_none()
    outcome = (
        CandidateIngestionOutcome.CREATED
        if candidate_id is not None
        else CandidateIngestionOutcome.EXISTING
    )

    if candidate_id is None:
        candidate_result = await db.execute(
            select(EventListingCandidate).where(
                EventListingCandidate.source_type == body.source_type,
                EventListingCandidate.external_source_id == body.external_source_id,
            )
        )
        candidate = candidate_result.scalar_one()
        response.status_code = status.HTTP_200_OK
    else:
        candidate = await db.get(EventListingCandidate, candidate_id)
        if candidate is None:
            raise RuntimeError("Candidate was inserted but could not be reloaded")

    audit = EventListingCandidateIngestionAudit(
        candidate_id=candidate.id,
        source_type=body.source_type,
        external_source_id=body.external_source_id,
        outcome=outcome,
        actor_type=credential.actor_type,
        actor_id=credential.actor_id,
        credential_label=credential.name,
    )
    db.add(audit)
    await db.commit()
    await db.refresh(candidate)
    await db.refresh(audit)

    return EventListingCandidateIngestionResponse(
        outcome=outcome,
        receipt_id=audit.id,
        candidate=EventListingCandidateResponse.model_validate(candidate),
    )
