"""Integration coverage for automatic Candidate publication after extraction."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models.event import Event
from app.models.event_audit import EventAuditAction, EventAuditLog
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    CandidateStatus,
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
    ExtractionJobStatus,
)
from app.services.candidate_publication import (
    AutoPublicationOutcome,
    process_auto_publication,
)
from app.services.extraction.jobs import claim_jobs, enqueue_extraction_job
from app.services.extraction.pipeline import process_claimed_jobs
from app.services.extraction.types import (
    ExtractionEvidence,
    ExtractionResult,
    Extractor,
)
from tests.conftest import _get_engine

# Fixed clock for pipeline runs; candidates use day offsets from it.
NOW = datetime.now(UTC)
# September 2026 is PDT (UTC-7), so the local day Sept 4 spans
# [2026-09-04 07:00Z, 2026-09-05 07:00Z).
SAME_LOCAL_DAY_MORNING = datetime(2026, 9, 4, 18, 0, tzinfo=UTC)
SAME_LOCAL_DAY_EVENING = datetime(2026, 9, 5, 2, 0, tzinfo=UTC)
NEXT_LOCAL_DAY = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)


def _candidate(candidate_id: str, **changes) -> EventListingCandidate:
    values = {
        "id": candidate_id,
        "description": "Caption evidence",
        "source_account": "ubcams",
        "source_type": "instagram",
        "external_source_id": f"post-{candidate_id}",
        "created_at": NOW - timedelta(hours=1),
    }
    values.update(changes)
    return EventListingCandidate(**values)


def _extracted_candidate(
    candidate_id: str, *, event_date: datetime, **changes
) -> EventListingCandidate:
    values = {
        "id": candidate_id,
        "description": "Caption evidence",
        "source_account": "ubcams",
        "source_type": "instagram",
        "external_source_id": f"post-{candidate_id}",
        "is_event": True,
        "title": "Club Night",
        "location_name": "The Nest",
        "event_date": event_date,
        "club_name": "UBC AMS",
        "vibes": ["social"],
        "source_label": "ams_club",
        "extracted_original": {"title": "Club Night"},
        "extracted_at": NOW - timedelta(hours=1),
        "created_at": NOW - timedelta(hours=2),
    }
    values.update(changes)
    return EventListingCandidate(**values)


def _result(  # noqa: PLR0913
    candidate_id: str,
    *,
    event_date: datetime | None,
    title: str | None = "Club Night",
    location_name: str | None = "The Nest",
    club_name: str | None = "UBC AMS",
    event_end_date: datetime | None = None,
) -> ExtractionResult:
    return ExtractionResult(
        candidate_id=candidate_id,
        is_event=True,
        title=title,
        location_name=location_name,
        event_date=event_date,
        event_end_date=event_end_date,
        club_name=club_name,
        vibes=("social",),
        raw={"is_event": True, "title": "Club Night"},
    )


def _event(club_name: str, event_date: datetime, **changes) -> Event:
    values = {
        "title": "Existing Event",
        "description": "",
        "source": "instagram",
        "source_label": "ams_club",
        "club_name": club_name,
        "vibes": ["social"],
        "location_name": "The Nest",
        "event_date": event_date,
    }
    values.update(changes)
    return Event(**values)


class StaticExtractor:
    def __init__(self, results: dict[str, ExtractionResult]) -> None:
        self.results = results

    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        return [self.results[item.candidate_id] for item in items]


class NoCallExtractor:
    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        raise AssertionError("extraction must not run again")


def _claimed_job(candidate_id: str) -> CandidateExtractionJob:
    return CandidateExtractionJob(
        candidate_id=candidate_id,
        status=ExtractionJobStatus.CLAIMED,
        available_at=NOW,
        claimed_at=NOW,
        attempts=1,
    )


async def _run_extraction(
    db_session: AsyncSession,
    results: dict[str, ExtractionResult],
    *,
    extractor: Extractor | None = None,
    now: datetime = NOW,
) -> None:
    for candidate_id in results:
        await enqueue_extraction_job(db_session, candidate_id, delay_seconds=0, now=now)
    claimed = await claim_jobs(db_session, len(results), now=now)
    await process_claimed_jobs(
        db_session, claimed, extractor or StaticExtractor(results), now=now
    )


async def _audits(db_session: AsyncSession, candidate_id: str) -> list[EventAuditLog]:
    return list(
        (
            await db_session.scalars(
                select(EventAuditLog).where(EventAuditLog.event_id == candidate_id)
            )
        ).all()
    )


@pytest.fixture(autouse=True)
def _embedding(monkeypatch) -> None:
    async def embedding(_event):
        return [0.1] * 1024

    monkeypatch.setattr("app.services.recommender.generate_event_embedding", embedding)


class TestAutoPublication:
    async def test_complete_candidate_publishes_with_same_id_and_system_audit(
        self, db_session: AsyncSession
    ):
        db_session.add(_candidate("autopub1"))
        await db_session.flush()
        await _run_extraction(
            db_session, {"autopub1": _result("autopub1", event_date=NEXT_LOCAL_DAY)}
        )

        candidate = await db_session.get(EventListingCandidate, "autopub1")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        event = await db_session.get(Event, "autopub1")
        assert event is not None
        assert event.title == "Club Night"
        assert event.source == "instagram"
        assert event.source_label == "ams_club"
        assert event.club_name == "UBC AMS"
        assert event.embedding == [0.1] * 1024

        audits = await _audits(db_session, "autopub1")
        assert [audit.action for audit in audits] == [EventAuditAction.CREATE]
        assert audits[0].actor_type == "system"

        job = await db_session.scalar(
            select(CandidateExtractionJob).where(
                CandidateExtractionJob.candidate_id == "autopub1"
            )
        )
        assert job is not None
        assert job.status == ExtractionJobStatus.SUCCEEDED

    async def test_incomplete_candidates_stay_pending_without_retry(
        self, db_session: AsyncSession
    ):
        results = {
            "incmp001": ExtractionResult(
                candidate_id="incmp001", is_event=False, raw={"is_event": False}
            ),
            "incmp002": _result("incmp002", event_date=NEXT_LOCAL_DAY, title=None),
            "incmp003": _result("incmp003", event_date=None),
            "incmp004": _result(
                "incmp004", event_date=NEXT_LOCAL_DAY, location_name=None
            ),
        }
        for candidate_id in results:
            db_session.add(_candidate(candidate_id))
        await db_session.flush()
        await _run_extraction(db_session, results)

        for candidate_id in results:
            candidate = await db_session.get(EventListingCandidate, candidate_id)
            assert candidate is not None
            assert candidate.status == CandidateStatus.PENDING
            assert await db_session.get(Event, candidate_id) is None
            job = await db_session.scalar(
                select(CandidateExtractionJob).where(
                    CandidateExtractionJob.candidate_id == candidate_id
                )
            )
            assert job is not None
            assert job.status == ExtractionJobStatus.SUCCEEDED

    async def test_campus_community_stays_pending_even_when_stale(
        self, db_session: AsyncSession
    ):
        # Extraction currently hard-codes AMS Club, so Campus Community reaches
        # publication decisions after an administrator correction.
        db_session.add_all(
            [
                _extracted_candidate(
                    "comty001",
                    event_date=NEXT_LOCAL_DAY,
                    source_label="campus_community",
                ),
                _extracted_candidate(
                    "comty002",
                    event_date=NOW - timedelta(hours=1),
                    source_label="campus_community",
                ),
            ]
        )
        await db_session.flush()
        db_session.add_all([_claimed_job("comty001"), _claimed_job("comty002")])
        await db_session.flush()
        jobs = list(
            (
                await db_session.scalars(
                    select(CandidateExtractionJob).where(
                        CandidateExtractionJob.candidate_id.in_(
                            ["comty001", "comty002"]
                        )
                    )
                )
            ).all()
        )
        await process_claimed_jobs(db_session, jobs, NoCallExtractor(), now=NOW)

        for candidate_id in ("comty001", "comty002"):
            candidate = await db_session.get(EventListingCandidate, candidate_id)
            assert candidate is not None
            assert candidate.status == CandidateStatus.PENDING
            assert await db_session.get(Event, candidate_id) is None

    async def test_stale_start_is_rejected_even_with_same_club_match(
        self, db_session: AsyncSession
    ):
        db_session.add(
            _extracted_candidate("holdref1", event_date=NOW - timedelta(hours=2))
        )
        db_session.add(_candidate("stale001"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {"stale001": _result("stale001", event_date=NOW - timedelta(hours=1))},
        )

        candidate = await db_session.get(EventListingCandidate, "stale001")
        assert candidate is not None
        assert candidate.status == CandidateStatus.REJECTED
        assert await db_session.get(Event, "stale001") is None
        assert await _audits(db_session, "stale001") == []
        job = await db_session.scalar(
            select(CandidateExtractionJob).where(
                CandidateExtractionJob.candidate_id == "stale001"
            )
        )
        assert job is not None
        assert job.status == ExtractionJobStatus.SUCCEEDED

    async def test_event_starting_right_now_still_publishes(
        self, db_session: AsyncSession
    ):
        db_session.add(_candidate("exact001"))
        await db_session.flush()
        await _run_extraction(
            db_session, {"exact001": _result("exact001", event_date=NOW)}
        )
        candidate = await db_session.get(EventListingCandidate, "exact001")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "exact001") is not None

    async def test_multiday_event_that_already_started_is_rejected(
        self, db_session: AsyncSession
    ):
        db_session.add(_candidate("multi001"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {
                "multi001": _result(
                    "multi001",
                    event_date=NOW - timedelta(days=1),
                    event_end_date=NOW + timedelta(days=2),
                )
            },
        )
        candidate = await db_session.get(EventListingCandidate, "multi001")
        assert candidate is not None
        assert candidate.status == CandidateStatus.REJECTED
        assert await db_session.get(Event, "multi001") is None


class TestSameClubSameDayHold:
    async def test_pending_candidate_match_withholds_publication(
        self, db_session: AsyncSession
    ):
        db_session.add(
            _extracted_candidate("holdref1", event_date=SAME_LOCAL_DAY_MORNING)
        )
        db_session.add(_candidate("holdnew1"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {"holdnew1": _result("holdnew1", event_date=SAME_LOCAL_DAY_EVENING)},
        )
        candidate = await db_session.get(EventListingCandidate, "holdnew1")
        assert candidate is not None
        assert candidate.status == CandidateStatus.PENDING
        assert await db_session.get(Event, "holdnew1") is None

    async def test_active_event_match_withholds_publication(
        self, db_session: AsyncSession
    ):
        db_session.add(_event("UBC AMS", SAME_LOCAL_DAY_MORNING, id="holdev01"))
        db_session.add(_candidate("holdnew1"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {"holdnew1": _result("holdnew1", event_date=SAME_LOCAL_DAY_EVENING)},
        )
        candidate = await db_session.get(EventListingCandidate, "holdnew1")
        assert candidate is not None
        assert candidate.status == CandidateStatus.PENDING
        assert await db_session.get(Event, "holdnew1") is None

    async def test_archived_event_and_other_days_do_not_hold(
        self, db_session: AsyncSession
    ):
        db_session.add(
            _event(
                "UBC AMS",
                SAME_LOCAL_DAY_MORNING,
                id="archiv01",
                is_archived=True,
                archived_at=NOW,
            )
        )
        db_session.add(_candidate("archnew1"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {"archnew1": _result("archnew1", event_date=SAME_LOCAL_DAY_EVENING)},
        )
        candidate = await db_session.get(EventListingCandidate, "archnew1")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "archnew1") is not None

        # Different club so the Event published above cannot interfere.
        db_session.add(
            _event("UBC Chess", NEXT_LOCAL_DAY + timedelta(hours=6), id="otherev1")
        )
        db_session.add(_candidate("othernw1"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {
                "othernw1": _result(
                    "othernw1", event_date=SAME_LOCAL_DAY_EVENING, club_name="UBC Chess"
                )
            },
        )
        candidate = await db_session.get(EventListingCandidate, "othernw1")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "othernw1") is not None

    async def test_club_comparison_trims_and_ignores_case(
        self, db_session: AsyncSession
    ):
        db_session.add(_event("  ubc ams  ", SAME_LOCAL_DAY_MORNING, id="trimve01"))
        db_session.add(_candidate("trimnw01"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {"trimnw01": _result("trimnw01", event_date=SAME_LOCAL_DAY_EVENING)},
        )
        candidate = await db_session.get(EventListingCandidate, "trimnw01")
        assert candidate is not None
        assert candidate.status == CandidateStatus.PENDING
        assert await db_session.get(Event, "trimnw01") is None

    async def test_missing_club_name_never_holds(self, db_session: AsyncSession):
        db_session.add(_event("UBC AMS", SAME_LOCAL_DAY_MORNING, id="noclubev"))
        db_session.add(_candidate("noclub01"))
        await db_session.flush()
        await _run_extraction(
            db_session,
            {
                "noclub01": _result(
                    "noclub01", event_date=SAME_LOCAL_DAY_EVENING, club_name=None
                )
            },
        )
        candidate = await db_session.get(EventListingCandidate, "noclub01")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "noclub01") is not None

    async def test_older_candidate_in_batch_wins_same_club_same_day(
        self, db_session: AsyncSession
    ):
        # Older candidate deliberately gets the lexicographically larger id, so
        # the batch order must follow created_at, not the id.
        older = _candidate("zzbatc01", created_at=NOW - timedelta(hours=3))
        newer = _candidate("aabatc02", created_at=NOW - timedelta(hours=1))
        db_session.add_all([older, newer])
        await db_session.flush()
        await _run_extraction(
            db_session,
            {
                "zzbatc01": _result("zzbatc01", event_date=SAME_LOCAL_DAY_MORNING),
                "aabatc02": _result("aabatc02", event_date=SAME_LOCAL_DAY_EVENING),
            },
        )
        published = await db_session.get(EventListingCandidate, "zzbatc01")
        assert published is not None
        assert published.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "zzbatc01") is not None
        held = await db_session.get(EventListingCandidate, "aabatc02")
        assert held is not None
        assert held.status == CandidateStatus.PENDING
        assert await db_session.get(Event, "aabatc02") is None


class TestRetriesAndConcurrency:
    async def test_transient_publication_failure_retries_and_publishes(
        self, db_session: AsyncSession, monkeypatch
    ):
        candidate = _candidate(
            "retry001",
            image_keys=["candidates/retry001/00.jpg"],
            created_at=NOW - timedelta(seconds=5),
        )
        db_session.add(candidate)
        await db_session.flush()

        monkeypatch.setattr(
            "app.services.s3.copy_object",
            MagicMock(side_effect=RuntimeError("copy down")),
        )
        await _run_extraction(
            db_session, {"retry001": _result("retry001", event_date=NEXT_LOCAL_DAY)}
        )
        await db_session.refresh(candidate)
        assert candidate.status == CandidateStatus.PENDING
        assert candidate.extracted_at is not None
        assert candidate.title == "Club Night"
        assert await db_session.get(Event, "retry001") is None
        job = await db_session.scalar(
            select(CandidateExtractionJob).where(
                CandidateExtractionJob.candidate_id == "retry001"
            )
        )
        assert job is not None
        assert job.status == ExtractionJobStatus.PENDING
        assert job.attempts == 1
        assert "auto-publication failed" in (job.last_error or "")

        copy = MagicMock()
        monkeypatch.setattr("app.services.s3.copy_object", copy)
        # fail_job requeued the same job with a 60-second backoff.
        claimed = await claim_jobs(db_session, 1, now=NOW + timedelta(seconds=61))
        await process_claimed_jobs(
            db_session,
            claimed,
            NoCallExtractor(),
            now=NOW + timedelta(seconds=61),
        )

        await db_session.refresh(candidate)
        assert candidate.status == CandidateStatus.APPROVED
        event = await db_session.get(Event, "retry001")
        assert event is not None
        copy.assert_called_once_with(
            "candidates/retry001/00.jpg", "event-pictures/retry001.webp"
        )
        await db_session.refresh(job)
        assert job.status == ExtractionJobStatus.SUCCEEDED

    async def test_rerun_after_publication_is_idempotent(
        self, db_session: AsyncSession
    ):
        db_session.add(_candidate("idemp001"))
        await db_session.flush()
        await _run_extraction(
            db_session, {"idemp001": _result("idemp001", event_date=NEXT_LOCAL_DAY)}
        )
        assert await db_session.get(Event, "idemp001") is not None

        rerun_job = await db_session.scalar(
            select(CandidateExtractionJob).where(
                CandidateExtractionJob.candidate_id == "idemp001"
            )
        )
        assert rerun_job is not None
        # Simulate a reclaim of the already-succeeded job.
        rerun_job.status = ExtractionJobStatus.PENDING
        rerun_job.claimed_at = None
        await db_session.flush()
        claimed = await claim_jobs(db_session, 1, now=NOW)
        await process_claimed_jobs(db_session, claimed, NoCallExtractor(), now=NOW)

        candidate = await db_session.get(EventListingCandidate, "idemp001")
        assert candidate is not None
        assert candidate.status == CandidateStatus.APPROVED
        assert await db_session.get(Event, "idemp001") is not None
        assert len(await _audits(db_session, "idemp001")) == 1

    async def test_concurrent_decisions_publish_exactly_once(self):
        candidate_id = f"c{uuid.uuid4().hex[:7]}"
        factory = async_sessionmaker(_get_engine(), expire_on_commit=False)

        async def _cleanup(session: AsyncSession) -> None:
            await session.execute(
                delete(EventAuditLog).where(EventAuditLog.event_id == candidate_id)
            )
            await session.execute(delete(Event).where(Event.id == candidate_id))
            await session.execute(
                delete(CandidateExtractionJob).where(
                    CandidateExtractionJob.candidate_id == candidate_id
                )
            )
            await session.execute(
                delete(EventListingCandidateIngestionAudit).where(
                    EventListingCandidateIngestionAudit.candidate_id == candidate_id
                )
            )
            await session.execute(
                delete(EventListingCandidate).where(
                    EventListingCandidate.id == candidate_id
                )
            )
            await session.commit()

        async with factory() as setup:
            await _cleanup(setup)
            setup.add(_extracted_candidate(candidate_id, event_date=NEXT_LOCAL_DAY))
            await setup.commit()

        async def decide_in_isolated_session() -> AutoPublicationOutcome:
            async with factory() as session:
                candidate = await session.get(EventListingCandidate, candidate_id)
                assert candidate is not None
                outcome = await process_auto_publication(session, candidate, now=NOW)
                await session.commit()
                return outcome

        outcomes = await asyncio.gather(
            decide_in_isolated_session(), decide_in_isolated_session()
        )
        assert sorted(outcome.value for outcome in outcomes) == [
            "pending",
            "published",
        ]

        async with factory() as verify:
            assert (
                await verify.scalar(select(Event.id).where(Event.id == candidate_id))
                == candidate_id
            )
            assert (
                len(
                    (
                        await verify.scalars(
                            select(EventAuditLog).where(
                                EventAuditLog.event_id == candidate_id
                            )
                        )
                    ).all()
                )
                == 1
            )
            await _cleanup(verify)


class TestHumanApprovalGuard:
    async def test_approval_rejects_event_that_already_started(
        self, admin_client: AsyncClient, db_session: AsyncSession
    ):
        db_session.add(
            _extracted_candidate("oldapp01", event_date=NOW - timedelta(days=1))
        )
        await db_session.flush()
        response = await admin_client.post("/admin/candidates/oldapp01/approve")
        assert response.status_code == 422
        assert "already started" in response.json()["detail"]
        assert await db_session.get(Event, "oldapp01") is None
        candidate = await db_session.get(EventListingCandidate, "oldapp01")
        assert candidate is not None
        assert candidate.status == CandidateStatus.PENDING

    async def test_returned_stale_candidate_cannot_be_approved(
        self, admin_client: AsyncClient, db_session: AsyncSession
    ):
        db_session.add(
            _extracted_candidate(
                "oldrej01",
                event_date=NOW - timedelta(days=1),
                status=CandidateStatus.REJECTED,
            )
        )
        await db_session.flush()
        returned = await admin_client.post(
            "/admin/candidates/oldrej01/return-to-review"
        )
        assert returned.status_code == 200
        approved = await admin_client.post("/admin/candidates/oldrej01/approve")
        assert approved.status_code == 422
        assert await db_session.get(Event, "oldrej01") is None
