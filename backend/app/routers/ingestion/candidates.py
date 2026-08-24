from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
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
from app.presenters.candidate import candidate_to_response
from app.schemas.event_listing_candidate import (
    CandidateImagePresignRequest,
    CandidateImagePresignResponse,
    EventListingCandidateIngestionRequest,
    EventListingCandidateIngestionResponse,
)
from app.schemas.user import PresignedUploadResponse
from app.services import s3
from app.services.candidate_images import candidate_image_key
from app.services.extraction.jobs import enqueue_extraction_job

router = APIRouter(prefix="/event-candidates", tags=["Candidate Ingestion"])


@router.post("/images/presign", response_model=CandidateImagePresignResponse)
async def presign_candidate_images(
    body: CandidateImagePresignRequest,
    _credential: CandidateIngestionCredential = Depends(require_candidate_ingester),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(EventListingCandidate).where(
            EventListingCandidate.source_type == body.source_type,
            EventListingCandidate.external_source_id == body.external_source_id,
        )
    )
    candidate = result.scalar_one_or_none()
    if candidate is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    uploads = []
    image_keys = []
    for index, content_type in enumerate(body.content_types):
        file_key = candidate_image_key(candidate.id, index, content_type)
        url, fields, key = s3.generate_presigned_upload_url(
            content_type=content_type,
            file_key=file_key,
            max_file_size_bytes=settings.candidate_image_max_bytes,
        )
        image_keys.append(key)
        uploads.append(
            PresignedUploadResponse(
                upload_url=url,
                fields=fields,
                file_key=key,
                max_file_size_bytes=settings.candidate_image_max_bytes,
            )
        )
    candidate.image_keys = image_keys
    await enqueue_extraction_job(
        db,
        candidate.id,
        delay_seconds=settings.extraction_image_settle_seconds,
    )
    await db.commit()
    return CandidateImagePresignResponse(uploads=uploads)


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
    values = body.model_dump()
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
    await enqueue_extraction_job(
        db,
        candidate.id,
        delay_seconds=(
            settings.extraction_image_settle_seconds if candidate.image_keys else 0
        ),
    )
    await db.commit()
    await db.refresh(candidate)
    await db.refresh(audit)

    return EventListingCandidateIngestionResponse(
        outcome=outcome,
        receipt_id=audit.id,
        candidate=candidate_to_response(candidate),
    )
