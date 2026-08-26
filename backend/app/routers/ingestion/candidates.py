from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
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
    EventListingCandidateIngestionRequest,
    EventListingCandidateIngestionResponse,
)
from app.schemas.user import PresignedUploadResponse
from app.services import s3
from app.services.candidate_images import candidate_image_key
from app.services.extraction.jobs import enqueue_extraction_job
from app.services.ids import generate_unique_id

router = APIRouter(prefix="/event-candidates", tags=["Candidate Ingestion"])


def _presigned_uploads(
    keys: list[str], content_types: list[str]
) -> list[PresignedUploadResponse]:
    uploads = []
    for file_key, content_type in zip(keys, content_types, strict=True):
        url, fields, key = s3.generate_presigned_upload_url(
            content_type=content_type,
            file_key=file_key,
            max_file_size_bytes=settings.candidate_image_max_bytes,
        )
        uploads.append(
            PresignedUploadResponse(
                upload_url=url,
                fields=fields,
                file_key=key,
                max_file_size_bytes=settings.candidate_image_max_bytes,
            )
        )
    return uploads


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
    values = body.model_dump(exclude={"image_content_types"})
    resolved_candidate: EventListingCandidate | None = None
    outcome: CandidateIngestionOutcome | None = None
    for _ in range(20):
        generated_id = await generate_unique_id(db)
        try:
            async with db.begin_nested():
                result = await db.execute(
                    insert(EventListingCandidate)
                    .values(id=generated_id, **values)
                    .on_conflict_do_nothing(
                        index_elements=[
                            EventListingCandidate.source_type,
                            EventListingCandidate.external_source_id,
                        ]
                    )
                    .returning(EventListingCandidate.id)
                )
                created_id = result.scalar_one_or_none()
                if created_id is not None:
                    resolved_candidate = await db.get(EventListingCandidate, created_id)
                    outcome = CandidateIngestionOutcome.CREATED
                else:
                    resolved_candidate = await db.scalar(
                        select(EventListingCandidate).where(
                            EventListingCandidate.source_type == body.source_type,
                            EventListingCandidate.external_source_id
                            == body.external_source_id,
                        )
                    )
                    if resolved_candidate is not None:
                        outcome = CandidateIngestionOutcome.EXISTING
        except IntegrityError as exc:
            if getattr(exc.orig, "sqlstate", None) != "23505":
                raise
        if resolved_candidate is not None and outcome is not None:
            break
    if resolved_candidate is None or outcome is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not allocate a unique Candidate id",
        )

    candidate = resolved_candidate
    if outcome is CandidateIngestionOutcome.EXISTING:
        response.status_code = status.HTTP_200_OK

    if outcome is CandidateIngestionOutcome.EXISTING:
        extensions = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
        expected = [extensions[item] for item in body.image_content_types]
        actual = [
            str(key).rsplit("/", 1)[-1].lower() for key in candidate.image_keys or []
        ]
        actual = ["." + item.rsplit(".", 1)[-1] for item in actual if "." in item]
        if len(actual) != len(expected) or actual != expected:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Candidate image content types conflict with existing capture",
            )
    else:
        requested_keys = [
            candidate_image_key(candidate.id, index, content_type)
            for index, content_type in enumerate(body.image_content_types)
        ]
        candidate.image_keys = requested_keys

    uploads = (
        []
        if candidate.extracted_at is not None
        else _presigned_uploads(candidate.image_keys or [], body.image_content_types)
    )

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
    await enqueue_extraction_job(db, candidate.id, delay_seconds=0)
    await db.commit()
    await db.refresh(candidate)
    await db.refresh(audit)

    return EventListingCandidateIngestionResponse(
        outcome=outcome,
        receipt_id=audit.id,
        candidate=candidate_to_response(candidate),
        uploads=uploads,
    )
