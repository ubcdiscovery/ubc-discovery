from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    EventListingCandidate,
)
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


async def process_claimed_jobs(
    session: AsyncSession,
    jobs: list[CandidateExtractionJob],
    extractor: Extractor,
    *,
    now: datetime | None = None,
) -> None:
    moment = now or datetime.now(UTC)
    ready: list[tuple[CandidateExtractionJob, ExtractionEvidence]] = []
    for job in jobs:
        candidate = await session.get(EventListingCandidate, job.candidate_id)
        if candidate is None:
            await fail_job(session, job, "candidate missing", now=moment)
            continue
        if candidate.extracted_at is not None:
            await complete_job(session, job, now=moment)
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
        ready.append((job, evidence))

    if not ready:
        return

    successes, failures = await _extract_with_fallback(
        extractor, [evidence for _job, evidence in ready]
    )
    for job, evidence in ready:
        error = failures.get(str(evidence.candidate_id))
        if error:
            await fail_job(session, job, error, now=moment)
            continue
        result: ExtractionResult | None = successes.get(evidence.candidate_id)
        if result is None:
            await fail_job(session, job, "missing extraction result", now=moment)
            continue
        candidate = await session.get(EventListingCandidate, job.candidate_id)
        if candidate is None:
            await fail_job(session, job, "candidate missing", now=moment)
            continue
        persist_extraction(
            candidate,
            result,
            model=settings.extraction_model,
            extracted_at=moment,
        )
        await complete_job(session, job, now=moment)
    await session.flush()
