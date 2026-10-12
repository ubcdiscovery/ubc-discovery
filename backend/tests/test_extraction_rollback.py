"""Rollback recovers delivery without replaying finished or failed candidates."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    CandidateStatus,
    EventListingCandidate,
    ExtractionJobStatus,
)
from app.services.extraction.jobs import claim_jobs
from app.services.extraction.pipeline import process_claimed_jobs
from app.services.extraction.rollback import RollbackAction, reconcile_legacy_jobs
from app.services.extraction.types import ExtractionEvidence, ExtractionResult


async def _candidate(session, **overrides):
    candidate = EventListingCandidate(
        source_type="instagram",
        source_account="rollback",
        external_source_id=str(uuid.uuid4()),
        **overrides,
    )
    session.add(candidate)
    await session.flush()
    return candidate


async def _job(session, candidate, **overrides):
    job = CandidateExtractionJob(candidate_id=candidate.id, **overrides)
    session.add(job)
    await session.flush()
    return job


async def test_default_dry_run_neither_creates_nor_resets_jobs(db_session):
    await _candidate(db_session)
    item = await _candidate(db_session)
    claimed_at = datetime.now(UTC)
    job = await _job(
        db_session,
        item,
        status=ExtractionJobStatus.CLAIMED,
        claimed_at=claimed_at,
        attempts=2,
        last_error="previous transport error",
    )

    outcomes = await reconcile_legacy_jobs(db_session)
    assert outcomes[RollbackAction.CREATE] == 1
    assert outcomes[RollbackAction.RESET] == 1
    await db_session.flush()
    jobs = (await db_session.scalars(select(CandidateExtractionJob))).all()
    assert jobs == [job]
    assert job.status == ExtractionJobStatus.CLAIMED
    assert job.claimed_at == claimed_at
    assert job.attempts == 2
    assert job.last_error == "previous transport error"


@pytest.mark.parametrize("status", list(ExtractionJobStatus))
async def test_unfinished_jobs_resume_once_and_reconciliation_is_idempotent(
    db_session, status
):
    now = datetime.now(UTC)
    fresh = await _candidate(db_session, capture_ready_at=now)
    saved = await _candidate(
        db_session,
        extracted_at=now,
        extracted_original={"is_event": False},
        is_event=False,
        processing_dispatched_at=now,
    )
    original = await _job(
        db_session,
        saved,
        status=status,
        attempts=3,
        claimed_at=now,
        last_error="publication transport failure",
    )
    outcomes = await reconcile_legacy_jobs(db_session, apply=True, now=now)
    assert outcomes[RollbackAction.CREATE] == 1
    assert outcomes[RollbackAction.RESET] == 1
    assert original.status == ExtractionJobStatus.PENDING
    assert original.available_at == now
    assert original.claimed_at is None
    assert original.attempts == 0
    assert original.last_error == "publication transport failure"
    assert saved.extracted_original == {"is_event": False}
    assert saved.extracted_at == now
    assert saved.processing_dispatched_at == now

    repeated = await reconcile_legacy_jobs(
        db_session, apply=True, now=now + timedelta(minutes=1)
    )
    assert repeated == {RollbackAction.UNCHANGED: 2}
    assert original.available_at == now
    claimed = await claim_jobs(db_session, 10, now=now)
    assert {job.candidate_id for job in claimed} == {fresh.id, saved.id}


async def test_completed_and_reviewed_candidates_cannot_be_claimed(db_session):
    now = datetime.now(UTC)
    for overrides in (
        {"processing_completed_at": now, "extracted_at": now},
        {"status": CandidateStatus.APPROVED},
        {"status": CandidateStatus.REJECTED},
    ):
        item = await _candidate(db_session, **overrides)
        await _job(
            db_session,
            item,
            status=ExtractionJobStatus.CLAIMED,
            claimed_at=now,
            last_error="retained for diagnosis",
        )
    await _candidate(db_session, processing_completed_at=now)
    outcomes = await reconcile_legacy_jobs(db_session, apply=True, now=now)
    assert outcomes == {RollbackAction.COMPLETE: 3, RollbackAction.UNCHANGED: 1}
    assert await claim_jobs(db_session, 10, now=now) == []
    for job in (await db_session.scalars(select(CandidateExtractionJob))).all():
        assert job.status == ExtractionJobStatus.SUCCEEDED
        assert job.claimed_at is None
        assert job.last_error == "retained for diagnosis"


async def test_terminal_candidates_stay_failed_until_explicit_replay(db_session):
    now = datetime.now(UTC)
    error = "delivery retry budget exhausted"
    terminal = await _candidate(
        db_session, processing_error=error, extracted_original={"title": "Saved"}
    )
    job = await _job(db_session, terminal, status=ExtractionJobStatus.PENDING)
    await _candidate(db_session, processing_error=error)
    outcomes = await reconcile_legacy_jobs(db_session, apply=True, now=now)
    assert outcomes == {RollbackAction.FAIL: 1, RollbackAction.UNCHANGED: 1}
    assert job.status == ExtractionJobStatus.FAILED
    assert terminal.processing_error == error
    assert terminal.extracted_original == {"title": "Saved"}
    assert await claim_jobs(db_session, 10, now=now) == []
    assert await reconcile_legacy_jobs(db_session, apply=True) == {
        RollbackAction.UNCHANGED: 2
    }


class UnexpectedExtractor:
    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        raise AssertionError("rollback must reuse paid extraction")


async def test_saved_extraction_without_a_legacy_job_finishes_without_ai(db_session):
    now = datetime.now(UTC)
    item = await _candidate(
        db_session,
        extracted_at=now,
        is_event=False,
        extracted_original={"is_event": False},
    )
    await reconcile_legacy_jobs(db_session, apply=True, now=now)
    jobs = await claim_jobs(db_session, 10, now=now)
    assert len(jobs) == 1
    await process_claimed_jobs(db_session, jobs, UnexpectedExtractor(), now=now)
    assert jobs[0].status == ExtractionJobStatus.SUCCEEDED
    assert item.processing_completed_at == now
    assert item.extracted_at == now
    assert item.extracted_original == {"is_event": False}
