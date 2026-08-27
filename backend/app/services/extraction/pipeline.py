from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    EventListingCandidate,
)
from app.services.candidate_publication import process_auto_publication
from app.services.extraction.evidence import assemble_evidence
from app.services.extraction.jobs import complete_job, delay_job, fail_job
from app.services.extraction.persist import persist_extraction
from app.services.extraction.types import (
    ExtractionEvidence,
    ExtractionResult,
    Extractor,
)

logger = logging.getLogger(__name__)


async def _extract_with_fallback(
    extractor: Extractor,
    items: list[ExtractionEvidence],
) -> tuple[dict, dict[str, str]]:
    try:
        results = await extractor.extract_many(items)
        if len(results) != len(items):
            raise ValueError("packed extractor returned the wrong count")
        return {result.candidate_id: result for result in results}, {}
    except Exception:
        logger.exception("Packed extraction failed; falling back to one candidate")

    successes: dict = {}
    failures: dict[str, str] = {}
    for item in items:
        try:
            results = await extractor.extract_many([item])
            if len(results) != 1:
                raise ValueError("fallback extractor returned the wrong count")
            successes[item.candidate_id] = results[0]
        except Exception as exc:
            logger.exception("Candidate extraction failed for %s", item.candidate_id)
            failures[str(item.candidate_id)] = str(exc)
    return successes, failures


def _past_image_wait(candidate: EventListingCandidate, now: datetime) -> bool:
    started = candidate.created_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    return now - started >= timedelta(seconds=settings.extraction_image_wait_seconds)


async def _settle_auto_publication(
    session: AsyncSession,
    job: CandidateExtractionJob,
    candidate: EventListingCandidate,
    *,
    now: datetime,
) -> None:
    """Decide auto-publication for an extracted Candidate, then finish the job.

    Publication runs inside a savepoint so a failure cannot roll back the
    persisted extraction. Validation and id-collision outcomes are permanent:
    the Candidate stays pending for human review and the job completes.
    Transient failures (embedding, image copy, database) requeue the job so
    the existing retry backoff re-attempts publication.
    """
    try:
        async with session.begin_nested():
            await process_auto_publication(session, candidate)
        await complete_job(session, job, now=now)
    except ValidationError, IntegrityError:
        logger.exception(
            "Auto-publication withheld for candidate %s; leaving it pending",
            job.candidate_id,
        )
        await complete_job(session, job, now=now)
    except Exception as exc:
        logger.exception(
            "Auto-publication failed for candidate %s; requeueing",
            job.candidate_id,
        )
        await fail_job(session, job, f"auto-publication failed: {exc}", now=now)


async def process_claimed_jobs(
    session: AsyncSession,
    jobs: list[CandidateExtractionJob],
    extractor: Extractor,
    *,
    now: datetime | None = None,
) -> None:
    moment = now or datetime.now(UTC)
    ready: list[
        tuple[CandidateExtractionJob, ExtractionEvidence, EventListingCandidate]
    ] = []
    for job in jobs:
        candidate = await session.get(EventListingCandidate, job.candidate_id)
        if candidate is None:
            await fail_job(session, job, "candidate missing", now=moment)
            continue
        if candidate.extracted_at is not None:
            await _settle_auto_publication(session, job, candidate, now=moment)
            continue
        evidence = assemble_evidence(candidate)
        if evidence.pending_image_keys and not _past_image_wait(candidate, moment):
            await delay_job(
                session,
                job,
                delay_seconds=settings.extraction_image_retry_seconds,
                error="source image not uploaded yet",
                now=moment,
            )
            continue
        ready.append((job, evidence, candidate))

    if not ready:
        return

    # Publication order is oldest-first so same-club same-day pairs inside one
    # batch resolve deterministically: the earlier Candidate publishes and the
    # later one is held.
    ready.sort(key=lambda item: (item[2].created_at, item[2].id))
    successes, failures = await _extract_with_fallback(
        extractor, [evidence for _job, evidence, _candidate in ready]
    )
    for job, evidence, candidate in ready:
        error = failures.get(str(evidence.candidate_id))
        if error:
            await fail_job(session, job, error, now=moment)
            continue
        result: ExtractionResult | None = successes.get(evidence.candidate_id)
        if result is None:
            await fail_job(session, job, "missing extraction result", now=moment)
            continue
        persist_extraction(
            candidate,
            result,
            model=settings.extraction_model,
            extracted_at=moment,
        )
        await _settle_auto_publication(session, job, candidate, now=moment)
    await session.flush()
