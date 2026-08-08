"""Integration tests for Event Listing Candidate intake and administration."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_listing_candidate import (
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)

CANDIDATE_HEADERS = {"Authorization": "Candidate-Key candidate-test-key"}
CANDIDATE_KEY_SETTING = "app.dependencies.settings.candidate_ingestion_api_key"


def _payload(
    external_source_id: str = "post-123",
    *,
    title: str = "Campus Candidate",
) -> dict:
    return {
        "title": title,
        "description": "A useful campus event description.",
        "club_name": "Campus Club",
        "source_url": "https://example.com/posts/post-123",
        "external_cta_label": "Learn more",
        "vibes": ["career", "social"],
        "location_name": "The Nest",
        "event_date": "2026-09-01T18:00:00Z",
        "event_end_date": "2026-09-01T20:00:00Z",
        "source_type": "instagram",
        "external_source_id": external_source_id,
        "source_excerpt": "Join us at The Nest for a campus workshop.",
        "image_reference": "instagram://media/post-123",
        "extraction_confidence": 0.91,
        "extraction_metadata": {
            "extractor_version": "2026-08-08",
            "model": "test-extractor",
            "field_count": 9,
        },
    }


def _model_payload(external_source_id: str = "post-123") -> dict:
    payload = _payload(external_source_id)
    payload["event_date"] = datetime.fromisoformat(
        payload["event_date"].replace("Z", "+00:00")
    )
    payload["event_end_date"] = datetime.fromisoformat(
        payload["event_end_date"].replace("Z", "+00:00")
    )
    return payload


class TestCandidateIngestionAuthorization:
    async def test_candidate_ingestion_requires_its_machine_credential(
        self, unauthed_client: AsyncClient
    ):
        with patch(
            CANDIDATE_KEY_SETTING, "candidate-test-key"
        ):
            missing = await unauthed_client.post(
                "/ingestion/event-candidates", json=_payload()
            )
            wrong_scheme = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers={"Authorization": "Api-Key candidate-test-key"},
                json=_payload("post-wrong-scheme"),
            )
            wrong_key = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers={"Authorization": "Candidate-Key wrong"},
                json=_payload("post-wrong-key"),
            )

        assert missing.status_code == 401
        assert wrong_scheme.status_code == 401
        assert wrong_key.status_code == 403

    async def test_candidate_credential_cannot_access_admin_operations(
        self, unauthed_client: AsyncClient
    ):
        with patch(
            CANDIDATE_KEY_SETTING, "candidate-test-key"
        ):
            response = await unauthed_client.get(
                "/admin/events",
                headers=CANDIDATE_HEADERS,
            )

        assert response.status_code == 401

    async def test_visitors_and_members_cannot_read_candidates(
        self, unauthed_client: AsyncClient, client: AsyncClient
    ):
        visitor = await unauthed_client.get("/admin/candidates")
        member = await client.get(
            "/admin/candidates",
            headers={"Authorization": "Bearer test-token"},
        )

        assert visitor.status_code == 401
        assert member.status_code == 403


class TestCandidateIngestion:
    async def test_ingestion_persists_normalized_fields_metadata_and_audit(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
    ):
        with patch(
            CANDIDATE_KEY_SETTING, "candidate-test-key"
        ):
            response = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json=_payload(),
            )

        assert response.status_code == 201
        data = response.json()
        assert data["outcome"] == "created"
        assert data["candidate"]["title"] == "Campus Candidate"
        assert data["candidate"]["source_type"] == "instagram"
        assert data["candidate"]["extraction_confidence"] == 0.91
        assert data["candidate"]["extraction_output"]["location_name"] == "The Nest"

        candidate = await db_session.get(
            EventListingCandidate, data["candidate"]["id"]
        )
        assert candidate is not None
        assert candidate.extraction_metadata["extractor_version"] == "2026-08-08"
        assert candidate.source_excerpt == "Join us at The Nest for a campus workshop."

        audit = await db_session.get(
            EventListingCandidateIngestionAudit, data["receipt_id"]
        )
        assert audit is not None
        assert audit.candidate_id == candidate.id
        assert audit.outcome == "created"
        assert audit.credential_name == "candidate-ingestion"

    async def test_repeated_identity_returns_existing_and_records_outcome(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
    ):
        with patch(
            CANDIDATE_KEY_SETTING, "candidate-test-key"
        ):
            first = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json=_payload(),
            )
            repeated_payload = _payload(title="Changed retry payload")
            second = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json=repeated_payload,
            )

        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["outcome"] == "existing"
        assert second.json()["candidate"]["id"] == first.json()["candidate"]["id"]
        assert second.json()["candidate"]["title"] == "Campus Candidate"

        audits = await db_session.scalars(
            select(EventListingCandidateIngestionAudit).order_by(
                EventListingCandidateIngestionAudit.received_at
            )
        )
        assert [audit.outcome for audit in audits.all()] == ["created", "existing"]

    async def test_ingestion_rejects_private_or_unmodeled_source_content(
        self, unauthed_client: AsyncClient
    ):
        with patch(
            CANDIDATE_KEY_SETTING, "candidate-test-key"
        ):
            extra_content = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json={**_payload("post-extra"), "full_email_body": "private content"},
            )
            email_excerpt = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json={
                    **_payload("post-email"),
                    "source_excerpt": "Contact organizer@example.com for details.",
                },
            )
            private_metadata = await unauthed_client.post(
                "/ingestion/event-candidates",
                headers=CANDIDATE_HEADERS,
                json={
                    **_payload("post-metadata"),
                    "extraction_metadata": {"raw_source": "private content"},
                },
            )

        assert extra_content.status_code == 422
        assert email_excerpt.status_code == 422
        assert private_metadata.status_code == 422


class TestAdminCandidateQueue:
    async def test_admin_can_filter_and_paginate_candidates(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        candidates = [
            EventListingCandidate(
                title=f"Queue Candidate {index}",
                description="Candidate description",
                vibes=["social"],
                source_type="instagram" if index < 2 else "calendar",
                external_source_id=f"queue-{index}",
                extraction_confidence=0.5 + index / 10,
                extraction_metadata={"extractor_version": "test"},
                extraction_output={"title": f"Queue Candidate {index}"},
                status="pending" if index < 2 else "rejected",
                created_at=datetime.now(UTC) - timedelta(minutes=index),
                updated_at=datetime.now(UTC) - timedelta(minutes=index),
            )
            for index in range(3)
        ]
        db_session.add_all(candidates)
        await db_session.flush()

        response = await admin_client.get(
            "/admin/candidates",
            params={
                "status": "pending",
                "source_type": "instagram",
                "skip": 1,
                "limit": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert len(data["candidates"]) == 1
        assert data["candidates"][0]["source_type"] == "instagram"

    async def test_admin_can_inspect_candidate_and_audit_history(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        candidate = EventListingCandidate(
            **{
                **_model_payload(),
                "extraction_output": {"title": "Campus Candidate"},
            }
        )
        db_session.add(candidate)
        await db_session.flush()
        audit = EventListingCandidateIngestionAudit(
            candidate_id=candidate.id,
            source_type=candidate.source_type,
            external_source_id=candidate.external_source_id,
            outcome="created",
            credential_name="candidate-ingestion",
        )
        db_session.add(audit)
        await db_session.flush()

        response = await admin_client.get(f"/admin/candidates/{candidate.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(candidate.id)
        assert data["source_excerpt"] == candidate.source_excerpt
        assert data["ingestion_audits"][0]["outcome"] == "created"

    async def test_candidates_are_not_public_event_listing_fields(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
    ):
        candidate = EventListingCandidate(
            **{
                **_model_payload("public-check"),
                "extraction_output": {"title": "Candidate-only title"},
            }
        )
        db_session.add(candidate)
        await db_session.flush()

        response = await unauthed_client.get("/events")

        assert response.status_code == 200
        assert all("source_excerpt" not in event for event in response.json()["events"])
        assert all(
            event["title"] != "Candidate-only title"
            for event in response.json()["events"]
        )
