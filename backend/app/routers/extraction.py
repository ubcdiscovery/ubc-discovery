"""Scoped machine endpoints for the independently deployed Queue consumer."""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ExtractionMode, settings
from app.database import get_db
from app.dependencies import require_candidate_extractor
from app.models.event_listing_candidate import CandidateStatus, EventListingCandidate
from app.schemas.extraction import (
    DeliveriesRequest,
    EvidenceRequest,
    EvidenceState,
    ResultsRequest,
    ResultStatus,
    TerminalRequest,
)
from app.services import s3
from app.services.candidate_publication import process_auto_publication
from app.services.extraction.persist import persist_extraction
from app.services.extraction.prompts import SYSTEM_PROMPT
from app.services.extraction.queue import capture_timed_out
from app.services.extraction.schema import RESPONSE_SCHEMA
from app.services.extraction.types import ExtractionResult

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/extraction",
    tags=["Queue Extraction"],
    dependencies=[Depends(require_candidate_extractor)],
)


def _require_queue_mode():
    if settings.extraction_mode != ExtractionMode.QUEUE:
        raise HTTPException(status_code=409, detail="Queue extraction mode is disabled")


@router.post("/evidence")
async def evidence(body: DeliveriesRequest, db: AsyncSession = Depends(get_db)):
    _require_queue_mode()
    rows = await db.scalars(
        select(EventListingCandidate)
        .where(
            EventListingCandidate.id.in_(item.candidate_id for item in body.candidates)
        )
        .order_by(EventListingCandidate.created_at, EventListingCandidate.id)
    )
    by_id = {item.id: item for item in rows}
    items = []
    now = datetime.now(UTC)
    for delivery in body.candidates:
        candidate_id = delivery.candidate_id
        candidate = by_id.get(candidate_id)
        if candidate is None:
            items.append({**delivery.model_dump(), "state": EvidenceState.MISSING})
            continue
        if candidate.processing_generation != delivery.generation:
            state = EvidenceState.STALE
        elif (
            candidate.processing_completed_at
            or candidate.status != CandidateStatus.PENDING
        ):
            state = EvidenceState.COMPLETED
        elif candidate.processing_error:
            state = EvidenceState.TERMINAL
        elif candidate.extracted_at:
            state = EvidenceState.EXTRACTED
        elif candidate.capture_ready_at is None and not capture_timed_out(
            candidate, now
        ):
            state = EvidenceState.WAITING
        else:
            state = EvidenceState.READY
        item = {
            "candidate_id": candidate.id,
            "generation": delivery.generation,
            "state": state,
            "created_at": candidate.created_at.isoformat(),
        }
        if state == EvidenceState.READY:
            item.update(
                caption=candidate.description,
                source_account=candidate.source_account,
                source_type=candidate.source_type,
                reference_timestamp=(
                    candidate.posted_at or candidate.created_at
                ).isoformat(),
                images=[
                    {"url": s3.generate_presigned_download_url(key)}
                    for key in candidate.image_keys or []
                    if s3.object_exists(key)
                ],
            )
        items.append(item)
    await db.commit()  # persist credential last_used_at
    return {
        "model": settings.extraction_model,
        "reasoning_effort": settings.extraction_reasoning_effort,
        "image_detail": settings.extraction_image_detail,
        "system_prompt": SYSTEM_PROMPT,
        "schema": RESPONSE_SCHEMA,
        "items": items,
    }


def _settled_status(
    candidate: EventListingCandidate, generation: int
) -> ResultStatus | None:
    if candidate.processing_generation != generation:
        return ResultStatus.STALE
    if candidate.processing_error:
        return ResultStatus.TERMINAL
    if candidate.processing_completed_at or candidate.status != CandidateStatus.PENDING:
        return ResultStatus.COMPLETED
    return None


@router.post("/results")
async def results(body: ResultsRequest, db: AsyncSession = Depends(get_db)):
    _require_queue_mode()
    by_id = {item.candidate_id: item for item in body.results}
    candidates = list(
        await db.scalars(
            select(EventListingCandidate)
            .where(EventListingCandidate.id.in_(by_id))
            .order_by(EventListingCandidate.created_at, EventListingCandidate.id)
            .with_for_update()
        )
    )
    outcomes = [
        {"candidate_id": item, "status": ResultStatus.MISSING}
        for item in by_id
        if item not in {c.id for c in candidates}
    ]
    ordered_ids = [candidate.id for candidate in candidates]
    await db.commit()
    # Persist and publish one candidate at a time, oldest first. Persisting all
    # outputs first changes same-club duplicate detection and holds both drafts.
    for candidate_id in ordered_ids:
        candidate = await db.scalar(
            select(EventListingCandidate)
            .where(EventListingCandidate.id == candidate_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert candidate is not None
        item = by_id[candidate_id]
        status = _settled_status(candidate, item.generation)
        if status is not None:
            outcomes.append({"candidate_id": candidate_id, "status": status})
            await db.commit()
            continue
        if candidate.extracted_at is None:
            if item.extraction is None:
                raise HTTPException(
                    status_code=409, detail=f"Extraction required for {candidate_id}"
                )
            if candidate.capture_ready_at is None and not capture_timed_out(
                candidate, datetime.now(UTC)
            ):
                raise HTTPException(
                    status_code=409, detail=f"Capture not ready for {candidate_id}"
                )
            value = item.extraction
            persist_extraction(
                candidate,
                ExtractionResult(
                    candidate_id=candidate_id,
                    is_event=value.is_event,
                    title=value.title,
                    event_date=value.event_date,
                    event_end_date=value.event_end_date,
                    location_name=value.location_name,
                    club_name=value.club_name,
                    vibes=tuple(value.vibes),
                    raw=value.model_dump(mode="json"),
                ),
                model=body.model,
                extracted_at=datetime.now(UTC),
            )
        await db.commit()
        candidate = await db.scalar(
            select(EventListingCandidate)
            .where(EventListingCandidate.id == candidate_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert candidate is not None
        # Explicit replay can happen between the extraction commit and publication.
        status = _settled_status(candidate, item.generation)
        if status is not None:
            outcomes.append({"candidate_id": candidate_id, "status": status})
            await db.commit()
            continue
        try:
            try:
                async with db.begin_nested():
                    await process_auto_publication(db, candidate, now=datetime.now(UTC))
            except ValidationError, IntegrityError:
                logger.exception("Queue auto-publication withheld for %s", candidate_id)
            candidate.processing_completed_at = datetime.now(UTC)
            await db.commit()
            outcomes.append(
                {"candidate_id": candidate_id, "status": ResultStatus.COMPLETED}
            )
        except Exception:
            logger.exception("Queue publication retry for %s", candidate_id)
            await db.rollback()
            outcomes.append(
                {"candidate_id": candidate_id, "status": ResultStatus.RETRY}
            )

    return {"results": outcomes}


@router.post("/terminal")
async def terminal(body: TerminalRequest, db: AsyncSession = Depends(get_db)):
    _require_queue_mode()
    candidate = await db.scalar(
        select(EventListingCandidate)
        .where(EventListingCandidate.id == body.candidate_id)
        .with_for_update()
    )
    if (
        candidate
        and candidate.processing_generation == body.generation
        and candidate.processing_completed_at is None
        and candidate.status == CandidateStatus.PENDING
    ):
        candidate.processing_error = body.error
    await db.commit()
    return {
        "candidate_id": body.candidate_id,
        "status": (
            ResultStatus.STALE
            if candidate and candidate.processing_generation != body.generation
            else ResultStatus.TERMINAL
        ),
    }


@router.get("/recovery")
async def recovery(
    limit: int = Query(default=10, ge=1, le=100), db: AsyncSession = Depends(get_db)
):
    _require_queue_mode()
    now = datetime.now(UTC)
    expired = await db.scalars(
        select(EventListingCandidate)
        .where(
            EventListingCandidate.status == CandidateStatus.PENDING,
            EventListingCandidate.processing_completed_at.is_(None),
            EventListingCandidate.processing_error.is_(None),
            EventListingCandidate.processing_dispatched_at
            < now - timedelta(seconds=settings.extraction_delivery_timeout_seconds),
        )
        .order_by(
            EventListingCandidate.processing_dispatched_at, EventListingCandidate.id
        )
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    for candidate in expired:
        candidate.processing_error = (
            "Queue delivery exceeded completion window; explicit replay required"
        )
    candidates = list(
        await db.scalars(
            select(EventListingCandidate)
            .where(
                EventListingCandidate.status == CandidateStatus.PENDING,
                EventListingCandidate.processing_completed_at.is_(None),
                EventListingCandidate.processing_error.is_(None),
                EventListingCandidate.processing_dispatched_at.is_(None),
                or_(
                    EventListingCandidate.capture_ready_at.is_not(None),
                    EventListingCandidate.created_at
                    <= now - timedelta(seconds=settings.extraction_image_wait_seconds),
                ),
            )
            .order_by(EventListingCandidate.created_at, EventListingCandidate.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    )
    deliveries = [
        {"candidate_id": candidate.id, "generation": candidate.processing_generation}
        for candidate in candidates
    ]
    await db.commit()

    return {"candidates": deliveries}


@router.post("/replay")
async def replay(body: EvidenceRequest, db: AsyncSession = Depends(get_db)):
    """Explicitly release terminal failures for a deliberate queue replay."""
    _require_queue_mode()
    candidates = await db.scalars(
        select(EventListingCandidate)
        .where(EventListingCandidate.id.in_(body.candidate_ids))
        .with_for_update()
    )
    replayed = []
    for candidate in candidates:
        if (
            candidate.processing_completed_at is None
            and candidate.status == CandidateStatus.PENDING
        ):
            candidate.processing_generation += 1
            candidate.processing_error = None
            candidate.processing_dispatched_at = None
            replayed.append(
                {
                    "candidate_id": candidate.id,
                    "generation": candidate.processing_generation,
                }
            )
    await db.commit()
    return {"candidates": replayed}


@router.post("/dispatched")
async def dispatched(body: DeliveriesRequest, db: AsyncSession = Depends(get_db)):
    _require_queue_mode()
    candidates = await db.scalars(
        select(EventListingCandidate)
        .where(
            EventListingCandidate.id.in_(item.candidate_id for item in body.candidates),
            EventListingCandidate.processing_completed_at.is_(None),
            EventListingCandidate.processing_error.is_(None),
            EventListingCandidate.processing_dispatched_at.is_(None),
        )
        .with_for_update()
    )
    deliveries = {(item.candidate_id, item.generation) for item in body.candidates}
    for candidate in candidates:
        if (candidate.id, candidate.processing_generation) in deliveries:
            candidate.processing_dispatched_at = datetime.now(UTC)
    await db.commit()
    return {"candidates": [item.model_dump() for item in body.candidates]}
