from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    EventListingCandidate,
    ExtractionJobStatus,
)


async def enqueue_extraction_job(
    session: AsyncSession,
    candidate_id: UUID,
    *,
    delay_seconds: int,
    now: datetime | None = None,
) -> CandidateExtractionJob | None:
    candidate = await session.get(EventListingCandidate, candidate_id)
    if candidate is None or candidate.extracted_at is not None:
        return None

    moment = now or datetime.now(UTC)
    available_at = moment + timedelta(seconds=delay_seconds)
    inserted = await session.execute(
        insert(CandidateExtractionJob)
        .values(
            candidate_id=candidate_id,
            status=ExtractionJobStatus.PENDING.value,
            available_at=available_at,
            updated_at=moment,
        )
        .on_conflict_do_update(
            index_elements=[CandidateExtractionJob.candidate_id],
            set_={
                "available_at": available_at,
                "status": ExtractionJobStatus.PENDING.value,
                "updated_at": moment,
                "claimed_at": None,
            },
            where=CandidateExtractionJob.status.in_(
                [
                    ExtractionJobStatus.PENDING.value,
                    ExtractionJobStatus.FAILED.value,
                ]
            ),
        )
        .returning(CandidateExtractionJob)
    )
    job = inserted.scalar_one_or_none()
    if job is not None:
        return job
    result = await session.execute(
        select(CandidateExtractionJob).where(
            CandidateExtractionJob.candidate_id == candidate_id
        )
    )
    return result.scalar_one_or_none()


async def reclaim_stale_jobs(
    session: AsyncSession, *, now: datetime | None = None
) -> int:
    moment = now or datetime.now(UTC)
    cutoff = moment - timedelta(seconds=settings.extraction_claim_timeout_seconds)
    result = await session.execute(
        update(CandidateExtractionJob)
        .where(
            CandidateExtractionJob.status == ExtractionJobStatus.CLAIMED.value,
            CandidateExtractionJob.claimed_at.is_not(None),
            CandidateExtractionJob.claimed_at < cutoff,
        )
        .values(
            status=ExtractionJobStatus.PENDING.value,
            claimed_at=None,
            updated_at=moment,
        )
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def due_job_count(session: AsyncSession, *, now: datetime | None = None) -> int:
    moment = now or datetime.now(UTC)
    result = await session.scalar(
        select(func.count())
        .select_from(CandidateExtractionJob)
        .where(
            CandidateExtractionJob.status == ExtractionJobStatus.PENDING.value,
            CandidateExtractionJob.available_at <= moment,
        )
    )
    return int(result or 0)


async def queue_is_quiet(session: AsyncSession, *, now: datetime | None = None) -> bool:
    moment = now or datetime.now(UTC)
    latest = await session.scalar(
        select(func.max(CandidateExtractionJob.updated_at)).where(
            CandidateExtractionJob.status != ExtractionJobStatus.SUCCEEDED.value
        )
    )
    if latest is None:
        return True
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=UTC)
    return (moment - latest) >= timedelta(seconds=settings.extraction_quiet_seconds)


async def jobs_to_claim_count(
    session: AsyncSession, *, now: datetime | None = None
) -> int:
    due = await due_job_count(session, now=now)
    batch_size = settings.extraction_batch_size
    if due >= batch_size:
        return batch_size
    if due >= 1 and await queue_is_quiet(session, now=now):
        return due
    return 0


async def claim_jobs(
    session: AsyncSession,
    limit: int,
    *,
    now: datetime | None = None,
) -> list[CandidateExtractionJob]:
    if limit <= 0:
        return []
    moment = now or datetime.now(UTC)
    result = await session.execute(
        select(CandidateExtractionJob)
        .where(
            CandidateExtractionJob.status == ExtractionJobStatus.PENDING.value,
            CandidateExtractionJob.available_at <= moment,
        )
        .order_by(
            CandidateExtractionJob.available_at.asc(),
            CandidateExtractionJob.id.asc(),
        )
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    jobs = list(result.scalars().all())
    for job in jobs:
        job.status = ExtractionJobStatus.CLAIMED
        job.claimed_at = moment
        job.updated_at = moment
    return jobs


async def delay_job(
    session: AsyncSession,
    job: CandidateExtractionJob,
    *,
    delay_seconds: int,
    error: str | None = None,
    now: datetime | None = None,
) -> None:
    moment = now or datetime.now(UTC)
    job.status = ExtractionJobStatus.PENDING
    job.claimed_at = None
    job.available_at = moment + timedelta(seconds=delay_seconds)
    job.updated_at = moment
    if error:
        job.last_error = error


async def fail_job(
    session: AsyncSession,
    job: CandidateExtractionJob,
    error: str,
    *,
    now: datetime | None = None,
) -> None:
    moment = now or datetime.now(UTC)
    job.last_error = error
    job.updated_at = moment
    job.claimed_at = None
    job.attempts += 1
    if job.attempts >= settings.extraction_max_attempts:
        job.status = ExtractionJobStatus.FAILED
    else:
        job.status = ExtractionJobStatus.PENDING
        job.available_at = moment + timedelta(seconds=min(60 * job.attempts, 600))


async def complete_job(
    session: AsyncSession,
    job: CandidateExtractionJob,
    *,
    now: datetime | None = None,
) -> None:
    moment = now or datetime.now(UTC)
    job.status = ExtractionJobStatus.SUCCEEDED
    job.claimed_at = None
    job.last_error = None
    job.updated_at = moment
