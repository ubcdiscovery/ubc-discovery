"""Queue contracts retain progress across retries without duplicating publication."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select

from app.config import settings
from app.models.api_credential import ApiCredential
from app.models.event_listing_candidate import (
    CandidateExtractionJob,
    EventListingCandidate,
)
from app.services import api_credentials


def deliveries(*ids, generation=1):
    return {
        "candidates": [{"candidate_id": item, "generation": generation} for item in ids]
    }


async def credential(db, user, scope):
    secret = api_credentials.generate_secret()
    item = ApiCredential(
        label=scope,
        scopes=[scope],
        secret_hash=api_credentials.hash_secret(secret),
        created_by_user_id=user.id,
    )
    db.add(item)
    await db.flush()
    return {"Authorization": f"Api-Key {api_credentials.format_token(item.id, secret)}"}


async def candidate(db, name="qtest001", **kwargs):
    item = EventListingCandidate(
        id=name,
        source_type="instagram",
        source_account="ams",
        external_source_id=name,
        description="caption",
        **kwargs,
    )
    db.add(item)
    await db.flush()
    return item


@pytest.fixture(autouse=True)
def queue_mode(monkeypatch):
    monkeypatch.setattr(settings, "extraction_mode", "queue")


async def test_scopes_isolate_ingestion_and_extraction(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:ingest")
    denied = await unauthed_client.post(
        "/extraction/evidence", json=deliveries("qtest001"), headers=headers
    )
    assert denied.status_code == 403
    headers = await credential(db_session, test_user, "candidates:extract")
    denied = await unauthed_client.post(
        "/ingestion/event-candidates", json={}, headers=headers
    )
    assert denied.status_code == 403


async def test_capture_checks_images_and_recovers_dispatch_failure(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:ingest")
    item = await candidate(db_session, image_keys=["capture.jpg"])
    with patch("app.services.s3.object_exists", return_value=False):
        response = await unauthed_client.post(
            f"/ingestion/event-candidates/{item.id}/capture-ready",
            json={},
            headers=headers,
        )
    assert response.status_code == 409
    with (
        patch("app.services.s3.object_exists", return_value=True),
        patch(
            "app.routers.ingestion.candidates.dispatch_candidates",
            new=AsyncMock(side_effect=RuntimeError("producer unavailable")),
        ),
    ):
        response = await unauthed_client.post(
            f"/ingestion/event-candidates/{item.id}/capture-ready",
            json={},
            headers=headers,
        )
    assert response.json() == {
        "candidate_id": item.id,
        "status": "ready",
        "dispatched": False,
    }
    assert item.capture_ready_at
    assert item.processing_dispatched_at is None
    assert (
        await db_session.scalar(
            select(func.count()).select_from(CandidateExtractionJob)
        )
        == 0
    )


async def test_evidence_uses_signed_urls_and_reports_waiting(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    ready = await candidate(
        db_session, capture_ready_at=datetime.now(UTC), image_keys=["capture.jpg"]
    )
    waiting = await candidate(db_session, "qtest002")
    with patch("app.services.s3.object_exists", return_value=True):
        response = await unauthed_client.post(
            "/extraction/evidence",
            json=deliveries(ready.id, waiting.id, "missing0"),
            headers=headers,
        )
    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["state"] for item in items] == ["ready", "waiting", "missing"]
    assert "X-Amz-Signature" in items[0]["images"][0]["url"]


async def test_extraction_survives_publication_retry_and_duplicate(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    item = await candidate(db_session, capture_ready_at=datetime.now(UTC))
    candidate_id = item.id
    body = {
        "model": "test-model",
        "results": [
            {
                "candidate_id": candidate_id,
                "generation": 1,
                "extraction": {"candidate_id": candidate_id, "is_event": False},
            }
        ],
    }
    with patch(
        "app.routers.extraction.process_auto_publication",
        new=AsyncMock(side_effect=RuntimeError("embedding unavailable")),
    ):
        response = await unauthed_client.post(
            "/extraction/results", json=body, headers=headers
        )
    assert response.json()["results"][0]["status"] == "retry"
    await db_session.refresh(item)
    assert item.extracted_at is not None
    assert item.processing_completed_at is None
    body["results"][0]["extraction"] = None
    publish = AsyncMock()
    with patch("app.routers.extraction.process_auto_publication", new=publish):
        first = await unauthed_client.post(
            "/extraction/results", json=body, headers=headers
        )
        duplicate = await unauthed_client.post(
            "/extraction/results", json=body, headers=headers
        )
    assert first.json()["results"][0]["status"] == "completed"
    assert duplicate.json()["results"][0]["status"] == "completed"
    assert publish.await_count == 1


async def test_recovery_requires_acceptance_completion_terminal_and_replay(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    now = datetime.now(UTC)
    ready = await candidate(db_session, capture_ready_at=now)
    await candidate(db_session, "qtest002", processing_completed_at=now)
    await candidate(
        db_session, "qtest003", capture_ready_at=now, processing_error="terminal"
    )
    await candidate(db_session, "qtest004", created_at=now - timedelta(seconds=400))
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert {item["candidate_id"] for item in response.json()["candidates"]} == {
        ready.id,
        "qtest004",
    }
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert {item["candidate_id"] for item in response.json()["candidates"]} == {
        ready.id,
        "qtest004",
    }
    await unauthed_client.post(
        "/extraction/dispatched",
        json=deliveries(ready.id, "qtest004"),
        headers=headers,
    )
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert response.json()["candidates"] == []
    await unauthed_client.post(
        "/extraction/replay", json={"candidate_ids": ["qtest003"]}, headers=headers
    )
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert response.json()["candidates"] == [
        {"candidate_id": "qtest003", "generation": 2}
    ]


async def test_results_publish_in_oldest_order(unauthed_client, db_session, test_user):
    headers = await credential(db_session, test_user, "candidates:extract")
    now = datetime.now(UTC)
    await candidate(
        db_session,
        "qtest001",
        capture_ready_at=now,
        created_at=now - timedelta(seconds=10),
    )
    await candidate(db_session, "qtest002", capture_ready_at=now, created_at=now)
    order = []

    async def publish(db, item, **kwargs):
        order.append(item.id)

    results = [
        {
            "candidate_id": cid,
            "generation": 1,
            "extraction": {"candidate_id": cid, "is_event": False},
        }
        for cid in ["qtest002", "qtest001"]
    ]
    with patch("app.routers.extraction.process_auto_publication", new=publish):
        response = await unauthed_client.post(
            "/extraction/results",
            json={"model": "test", "results": results},
            headers=headers,
        )
    assert response.status_code == 200
    assert order == ["qtest001", "qtest002"]


async def test_unknown_scope_rejected_by_api(credential_admin_client):
    response = await credential_admin_client.post(
        "/admin/api-keys", json={"label": "unsafe", "scopes": ["admin:all"]}
    )
    assert response.status_code == 422


async def test_terminal_reporting_does_not_override_completion(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    item = await candidate(db_session, processing_completed_at=datetime.now(UTC))
    response = await unauthed_client.post(
        "/extraction/terminal",
        json={
            "candidate_id": item.id,
            "generation": 1,
            "error": "late duplicate failure",
        },
        headers=headers,
    )
    assert response.status_code == 200
    await db_session.refresh(item)
    assert item.processing_error is None


async def test_accepted_delivery_expires_terminal_without_redispatch(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    item = await candidate(
        db_session,
        capture_ready_at=datetime.now(UTC),
        processing_dispatched_at=datetime.now(UTC) - timedelta(hours=26),
    )
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert response.json()["candidates"] == []
    await db_session.refresh(item)
    assert item.processing_error and "explicit replay" in item.processing_error


async def test_capture_retry_keeps_first_acceptance_timestamp(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:ingest")
    accepted = datetime.now(UTC) - timedelta(hours=1)
    item = await candidate(
        db_session, capture_ready_at=accepted, processing_dispatched_at=accepted
    )
    sender = AsyncMock(return_value=True)
    with patch("app.routers.ingestion.candidates.dispatch_candidates", new=sender):
        response = await unauthed_client.post(
            f"/ingestion/event-candidates/{item.id}/capture-ready",
            json={},
            headers=headers,
        )
    assert response.status_code == 200
    sender.assert_not_awaited()
    assert item.processing_dispatched_at == accepted


async def test_same_club_batch_publishes_oldest_only(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    now = datetime.now(UTC)
    first = await candidate(
        db_session,
        "qtest001",
        capture_ready_at=now,
        created_at=now - timedelta(seconds=10),
    )
    second = await candidate(
        db_session, "qtest002", capture_ready_at=now, created_at=now
    )
    results = [
        {
            "candidate_id": cid,
            "generation": 1,
            "extraction": {
                "candidate_id": cid,
                "is_event": True,
                "title": "Club Night",
                "location_name": "The Nest",
                "event_date": (now + timedelta(days=2)).isoformat(),
                "club_name": "UBC AMS",
                "vibes": ["social"],
            },
        }
        for cid in [second.id, first.id]
    ]
    response = await unauthed_client.post(
        "/extraction/results",
        json={"model": "test", "results": results},
        headers=headers,
    )
    assert response.status_code == 200
    await db_session.refresh(first)
    await db_session.refresh(second)
    assert first.status == "approved"
    assert second.status == "pending"
    assert first.processing_completed_at and second.processing_completed_at


async def test_legacy_completion_after_migration_excluded_from_queue_recovery(
    unauthed_client, db_session, test_user
):
    from app.models.event_listing_candidate import ExtractionJobStatus
    from app.services.extraction.jobs import complete_job

    headers = await credential(db_session, test_user, "candidates:extract")
    now = datetime.now(UTC)
    item = await candidate(db_session, extracted_at=now)
    job = CandidateExtractionJob(
        candidate_id=item.id, status=ExtractionJobStatus.CLAIMED
    )
    db_session.add(job)
    await db_session.flush()
    await complete_job(db_session, job, now=now)
    await db_session.commit()
    response = await unauthed_client.get("/extraction/recovery", headers=headers)
    assert response.json()["candidates"] == []
    assert item.status == "pending"
    assert item.processing_completed_at == now


async def test_legacy_terminal_failure_and_explicit_reingestion_progress(db_session):
    from app.models.event_listing_candidate import ExtractionJobStatus
    from app.services.extraction.jobs import enqueue_extraction_job, fail_job

    item = await candidate(db_session)
    job = await enqueue_extraction_job(db_session, item.id, delay_seconds=0)
    assert job is not None
    job.attempts = settings.extraction_max_attempts - 1
    await fail_job(db_session, job, "AI unavailable")
    assert job.status == ExtractionJobStatus.FAILED
    assert item.processing_error == "AI unavailable"
    await db_session.flush()
    await enqueue_extraction_job(db_session, item.id, delay_seconds=0)
    assert item.processing_error is None


async def test_replay_fences_old_dlq_and_acceptance(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    item = await candidate(
        db_session,
        capture_ready_at=datetime.now(UTC),
        processing_error="Original delivery exhausted",
        processing_dispatched_at=datetime.now(UTC),
    )
    response = await unauthed_client.post(
        "/extraction/replay", json={"candidate_ids": [item.id]}, headers=headers
    )
    assert response.json() == deliveries(item.id, generation=2)
    # An original DLQ delivery may retry after an operator has replayed the job.
    response = await unauthed_client.post(
        "/extraction/terminal",
        json={
            "candidate_id": item.id,
            "generation": 1,
            "error": "Queue retries exhausted",
        },
        headers=headers,
    )
    assert response.json()["status"] == "stale"
    await unauthed_client.post(
        "/extraction/dispatched", json=deliveries(item.id), headers=headers
    )
    await db_session.refresh(item)
    assert item.processing_generation == 2
    assert item.processing_error is None
    assert item.processing_dispatched_at is None
    response = await unauthed_client.post(
        "/extraction/evidence",
        json={
            "candidates": [
                {"candidate_id": item.id, "generation": 1},
                {"candidate_id": item.id, "generation": 2},
            ]
        },
        headers=headers,
    )
    assert [value["state"] for value in response.json()["items"]] == ["stale", "ready"]
    # Receipt order must not let an old generation hide a current acceptance.
    await unauthed_client.post(
        "/extraction/dispatched",
        json={
            "candidates": [
                {"candidate_id": item.id, "generation": 2},
                {"candidate_id": item.id, "generation": 1},
            ]
        },
        headers=headers,
    )
    await db_session.refresh(item)
    assert item.processing_dispatched_at is not None


async def test_replay_fences_stale_primary_results(
    unauthed_client, db_session, test_user
):
    headers = await credential(db_session, test_user, "candidates:extract")
    item = await candidate(db_session, capture_ready_at=datetime.now(UTC))
    await unauthed_client.post(
        "/extraction/replay", json={"candidate_ids": [item.id]}, headers=headers
    )
    result = {
        "candidate_id": item.id,
        "generation": 1,
        "extraction": {"candidate_id": item.id, "is_event": False},
    }
    publish = AsyncMock()
    with patch("app.routers.extraction.process_auto_publication", new=publish):
        response = await unauthed_client.post(
            "/extraction/results",
            json={"model": "stale", "results": [result]},
            headers=headers,
        )
        assert response.json()["results"][0]["status"] == "stale"
        await db_session.refresh(item)
        assert item.extracted_at is None
        assert item.processing_completed_at is None
        publish.assert_not_awaited()
        result["generation"] = 2
        response = await unauthed_client.post(
            "/extraction/results",
            json={"model": "current", "results": [result]},
            headers=headers,
        )
        assert response.json()["results"][0]["status"] == "completed"
        assert item.extraction_model == "current"
        publish.assert_awaited_once()
