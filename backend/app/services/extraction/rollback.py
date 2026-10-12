"""Rebuild legacy delivery state while every extraction processor is stopped."""

from collections import Counter
from datetime import UTC, datetime
from enum import StrEnum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    CandidateStatus,
    EventListingCandidate,
    ExtractionJobStatus,
)


class RollbackAction(StrEnum):
    CREATE = "create"
    RESET = "reset"
    COMPLETE = "complete"
    FAIL = "fail"
    UNCHANGED = "unchanged"


def _action(
    candidate: EventListingCandidate, job: CandidateExtractionJob | None
) -> RollbackAction:
    # Terminal progress requires deliberate replay; rollback is not replay.
    if candidate.processing_error is not None:
        if job is not None and (
            job.status != ExtractionJobStatus.FAILED or job.claimed_at is not None
        ):
            return RollbackAction.FAIL
        return RollbackAction.UNCHANGED
    if (
        candidate.processing_completed_at is not None
        or candidate.status != CandidateStatus.PENDING
    ):
        if job is not None and (
            job.status != ExtractionJobStatus.SUCCEEDED or job.claimed_at is not None
        ):
            return RollbackAction.COMPLETE
        return RollbackAction.UNCHANGED
    if job is None:
        return RollbackAction.CREATE
    if (
        job.status != ExtractionJobStatus.PENDING
        or job.claimed_at is not None
        or job.attempts != 0
    ):
        return RollbackAction.RESET
    return RollbackAction.UNCHANGED


async def reconcile_legacy_jobs(
    session: AsyncSession, *, apply: bool = False, now: datetime | None = None
) -> Counter[RollbackAction]:
    """Plan or apply idempotent delivery repair; caller owns the transaction.

    Stop API producers, Queue/DLQ consumers, recovery cron, and the legacy
    worker first. Candidate locks protect the snapshot during an applied run,
    but cannot stop a remote invocation already using evidence. Do not resume
    processing until this transaction commits.
    """
    moment = now or datetime.now(UTC)
    query = (
        select(EventListingCandidate, CandidateExtractionJob)
        .outerjoin(
            CandidateExtractionJob,
            CandidateExtractionJob.candidate_id == EventListingCandidate.id,
        )
        .order_by(EventListingCandidate.created_at, EventListingCandidate.id)
    )
    if apply:
        query = query.with_for_update(of=EventListingCandidate)
    outcomes: Counter[RollbackAction] = Counter()
    for candidate, job in (await session.execute(query)).all():
        action = _action(candidate, job)
        outcomes[action] += 1
        if not apply or action == RollbackAction.UNCHANGED:
            continue
        if action == RollbackAction.CREATE:
            session.add(
                CandidateExtractionJob(
                    candidate_id=candidate.id,
                    status=ExtractionJobStatus.PENDING,
                    available_at=moment,
                    attempts=0,
                    updated_at=moment,
                )
            )
            continue
        assert job is not None
        job.claimed_at = None
        job.updated_at = moment
        if action == RollbackAction.RESET:
            job.status = ExtractionJobStatus.PENDING
            job.available_at = moment
            job.attempts = 0
        elif action == RollbackAction.COMPLETE:
            job.status = ExtractionJobStatus.SUCCEEDED
        else:
            job.status = ExtractionJobStatus.FAILED
        # Retain last_error for diagnosis, and never alter candidate progress,
        # terminal errors, review decisions, or paid extraction results.
    if apply:
        await session.flush()
    return outcomes
