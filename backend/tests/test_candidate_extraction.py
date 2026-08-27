"""Tests for async Candidate extraction jobs, batching, and persistence."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    EventListingCandidate,
    ExtractionJobStatus,
)
from app.services.extraction.jobs import (
    claim_jobs,
    enqueue_extraction_job,
    jobs_to_claim_count,
)
from app.services.extraction.pipeline import process_claimed_jobs
from app.services.extraction.types import ExtractionEvidence, ExtractionResult


def _payload(external_source_id: str, **overrides) -> dict:
    data = {
        "description": "Club night at the Nest this Friday.",
        "source_account": "ubcams",
        "source_url": "https://example.com/posts/post-123",
        "source_type": "instagram",
        "external_source_id": external_source_id,
        "image_content_types": [],
    }
    data.update(overrides)
    return data


async def _mint_credential(client: AsyncClient) -> str:
    response = await client.post(
        "/admin/api-keys", json={"label": "Extractor importer"}
    )
    assert response.status_code == 201, response.text
    return response.json()["raw_token"]


def _api_key_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Api-Key {token}"}


async def _insert_candidate(
    db_session: AsyncSession, **overrides
) -> EventListingCandidate:
    values = {
        "description": "Club night at the Nest this Friday.",
        "source_account": "ubcams",
        "source_type": "instagram",
        "external_source_id": f"post-{uuid.uuid4()}",
    }
    values.update(overrides)
    candidate = EventListingCandidate(**values)
    db_session.add(candidate)
    await db_session.flush()
    return candidate


def _result_for(candidate_id, *, is_event: bool = True) -> ExtractionResult:
    if not is_event:
        return ExtractionResult(
            candidate_id=candidate_id,
            is_event=False,
            raw={"is_event": False, "title": None},
        )
    return ExtractionResult(
        candidate_id=candidate_id,
        is_event=True,
        title="Club Night",
        location_name="The Nest",
        # Keep the fixture future-dated; complete results auto-publish now.
        event_date=datetime.now(UTC) + timedelta(days=7),
        club_name="UBC AMS",
        vibes=("social",),
        raw={"is_event": True, "title": "Club Night"},
    )


class RecordingExtractor:
    def __init__(self, factory) -> None:
        self.factory = factory
        self.calls: list[list[str]] = []

    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        self.calls.append([item.candidate_id for item in items])
        return [self.factory(item) for item in items]


class PackedThenSingleExtractor:
    def __init__(self) -> None:
        self.calls: list[int] = []

    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        self.calls.append(len(items))
        if len(items) > 1:
            raise RuntimeError("packed extractor exploded")
        return [_result_for(items[0].candidate_id)]


class FailingExtractor:
    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        raise ValueError("invalid model output")


class TestCandidateExtraction:
    async def test_ingestion_returns_without_extracting_and_enqueues_a_job(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        token = await _mint_credential(credential_admin_client)
        response = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json=_payload("extract-enqueue"),
        )
        assert response.status_code == 201
        candidate_id = response.json()["candidate"]["id"]
        candidate = await db_session.get(EventListingCandidate, candidate_id)
        assert candidate is not None
        assert candidate.extracted_at is None
        job = (
            await db_session.execute(
                select(CandidateExtractionJob).where(
                    CandidateExtractionJob.candidate_id == candidate.id
                )
            )
        ).scalar_one()
        assert job.status == ExtractionJobStatus.PENDING
        assert job.available_at <= datetime.now(UTC) + timedelta(seconds=1)

    async def test_ingestion_reserves_images_and_early_claims_wait_for_upload(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch,
    ):
        monkeypatch.setattr(
            "app.services.extraction.evidence.s3.object_exists", lambda _key: False
        )
        token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        ingested = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload(
                "extract-upload-wait",
                image_content_types=["image/jpeg"],
            ),
        )
        assert ingested.status_code == 201
        candidate_id = ingested.json()["candidate"]["id"]
        assert ingested.json()["uploads"][0]["file_key"] == (
            f"candidates/{candidate_id}/00.jpg"
        )
        candidate = await db_session.get(EventListingCandidate, candidate_id)
        assert candidate is not None
        assert candidate.image_keys == [f"candidates/{candidate_id}/00.jpg"]

        job = (
            await db_session.execute(
                select(CandidateExtractionJob).where(
                    CandidateExtractionJob.candidate_id == candidate_id
                )
            )
        ).scalar_one()
        assert job.status == ExtractionJobStatus.PENDING

        now = datetime.now(UTC)
        candidate.created_at = now
        await db_session.flush()
        claimed = await claim_jobs(db_session, 1, now=now)
        assert [item.candidate_id for item in claimed] == [candidate_id]
        extractor = RecordingExtractor(lambda item: _result_for(item.candidate_id))
        await process_claimed_jobs(db_session, claimed, extractor, now=now)
        assert extractor.calls == []
        await db_session.flush()
        await db_session.refresh(job)
        assert job.status == ExtractionJobStatus.PENDING
        assert job.last_error == "source image not uploaded yet"

    async def test_full_pack_is_claimed_without_waiting_for_quiet(
        self, db_session: AsyncSession, monkeypatch
    ):
        monkeypatch.setattr(settings, "extraction_quiet_seconds", 10_000)
        pack = settings.extraction_batch_size
        now = datetime.now(UTC)
        for _ in range(pack):
            candidate = await _insert_candidate(db_session)
            await enqueue_extraction_job(
                db_session, candidate.id, delay_seconds=0, now=now
            )
        assert await jobs_to_claim_count(db_session, now=now) == pack
        jobs = await claim_jobs(db_session, pack, now=now)
        assert len(jobs) == pack

    async def test_leftover_pack_waits_for_quiet(
        self, db_session: AsyncSession, monkeypatch
    ):
        monkeypatch.setattr(settings, "extraction_quiet_seconds", 120)
        now = datetime.now(UTC)
        for _ in range(2):
            candidate = await _insert_candidate(db_session)
            await enqueue_extraction_job(
                db_session, candidate.id, delay_seconds=0, now=now
            )
        assert await jobs_to_claim_count(db_session, now=now) == 0
        assert (
            await jobs_to_claim_count(db_session, now=now + timedelta(seconds=121)) == 2
        )

    async def test_existing_snapshot_skips_a_second_extract(
        self, db_session: AsyncSession
    ):
        now = datetime.now(UTC)
        candidate = await _insert_candidate(db_session)
        candidate.extracted_at = now
        candidate.extracted_original = {"is_event": True, "title": "Kept"}
        await db_session.flush()
        assert (
            await enqueue_extraction_job(
                db_session, candidate.id, delay_seconds=0, now=now
            )
            is None
        )
        extractor = RecordingExtractor(lambda item: _result_for(item.candidate_id))
        job = CandidateExtractionJob(
            candidate_id=candidate.id,
            status=ExtractionJobStatus.CLAIMED,
            available_at=now,
            claimed_at=now,
            attempts=1,
        )
        db_session.add(job)
        await db_session.flush()
        await process_claimed_jobs(db_session, [job], extractor, now=now)
        await db_session.refresh(candidate)
        assert candidate.extracted_original == {"is_event": True, "title": "Kept"}
        assert extractor.calls == []
        assert job.status == ExtractionJobStatus.SUCCEEDED

    async def test_failed_extract_retries_then_persists_original_and_draft(
        self, db_session: AsyncSession, monkeypatch
    ):
        monkeypatch.setattr(settings, "extraction_max_attempts", 5)
        now = datetime.now(UTC)
        candidate = await _insert_candidate(db_session)
        job = await enqueue_extraction_job(
            db_session, candidate.id, delay_seconds=0, now=now
        )
        assert job is not None
        claimed = await claim_jobs(db_session, 1, now=now)
        await process_claimed_jobs(db_session, claimed, FailingExtractor(), now=now)
        await db_session.refresh(job)
        await db_session.refresh(candidate)
        assert job.status == ExtractionJobStatus.PENDING
        assert candidate.extracted_at is None

        claimed = await claim_jobs(db_session, 1, now=now + timedelta(minutes=2))
        extractor = RecordingExtractor(lambda item: _result_for(item.candidate_id))
        await process_claimed_jobs(
            db_session, claimed, extractor, now=now + timedelta(minutes=2)
        )
        assert job.status == ExtractionJobStatus.SUCCEEDED
        assert candidate.is_event is True
        assert candidate.title == "Club Night"
        assert candidate.source_label == "ams_club"
        assert candidate.extracted_original["title"] == "Club Night"
        assert candidate.extracted_at is not None

    async def test_invalid_output_and_non_event_leave_drafts_empty(
        self, db_session: AsyncSession
    ):
        now = datetime.now(UTC)
        invalid = await _insert_candidate(db_session)
        non_event = await _insert_candidate(db_session)
        invalid_job = await enqueue_extraction_job(
            db_session, invalid.id, delay_seconds=0, now=now
        )
        non_event_job = await enqueue_extraction_job(
            db_session, non_event.id, delay_seconds=0, now=now
        )
        claimed = await claim_jobs(db_session, 2, now=now)
        by_id = {job.candidate_id: job for job in claimed}

        await process_claimed_jobs(
            db_session, [by_id[invalid.id]], FailingExtractor(), now=now
        )
        await db_session.refresh(invalid)
        assert invalid.extracted_at is None
        assert invalid.title is None

        await process_claimed_jobs(
            db_session,
            [by_id[non_event.id]],
            RecordingExtractor(
                lambda item: _result_for(item.candidate_id, is_event=False)
            ),
            now=now,
        )
        await db_session.refresh(non_event)
        await db_session.refresh(non_event_job)
        assert non_event.is_event is False
        assert non_event.title is None
        assert non_event.extracted_at is not None
        assert non_event_job is not None
        assert non_event_job.status == ExtractionJobStatus.SUCCEEDED
        assert invalid_job is not None
        await db_session.refresh(invalid_job)
        assert invalid_job.status == ExtractionJobStatus.PENDING

    async def test_missing_s3_object_waits_then_extracts_caption_only(
        self, db_session: AsyncSession, monkeypatch
    ):
        now = datetime.now(UTC)
        candidate = await _insert_candidate(
            db_session,
            image_keys=["candidates/missing/00.jpg"],
            created_at=now,
        )
        await enqueue_extraction_job(db_session, candidate.id, delay_seconds=0, now=now)
        monkeypatch.setattr(
            "app.services.extraction.evidence.s3.object_exists", lambda _key: False
        )
        extractor = RecordingExtractor(lambda item: _result_for(item.candidate_id))
        claimed = await claim_jobs(db_session, 1, now=now)
        await process_claimed_jobs(db_session, claimed, extractor, now=now)
        job = claimed[0]
        await db_session.refresh(job)
        await db_session.refresh(candidate)
        assert job.status == ExtractionJobStatus.PENDING
        assert candidate.extracted_at is None
        assert extractor.calls == []

        later = now + timedelta(seconds=settings.extraction_image_wait_seconds + 1)
        claimed = await claim_jobs(db_session, 1, now=later)
        await process_claimed_jobs(db_session, claimed, extractor, now=later)
        await db_session.refresh(candidate)
        assert candidate.extracted_at is not None
        assert extractor.calls[0]
        # Caption-only: no images were downloaded.
        assert candidate.title == "Club Night"

    async def test_packed_extractor_error_falls_back_to_one_candidate(
        self, db_session: AsyncSession
    ):
        now = datetime.now(UTC)
        candidates = [await _insert_candidate(db_session) for _ in range(2)]
        for candidate in candidates:
            await enqueue_extraction_job(
                db_session, candidate.id, delay_seconds=0, now=now
            )
        claimed = await claim_jobs(db_session, 2, now=now)
        extractor = PackedThenSingleExtractor()
        await process_claimed_jobs(db_session, claimed, extractor, now=now)
        assert extractor.calls[0] == 2
        assert extractor.calls[1:] == [1, 1]
        for candidate in candidates:
            await db_session.refresh(candidate)
            assert candidate.extracted_at is not None
            assert candidate.title == "Club Night"
