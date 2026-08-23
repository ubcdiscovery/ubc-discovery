"""Integration tests for Event Listing Candidate intake and administration."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_credential import ApiCredential
from app.models.audit_actor import AuditActorType
from app.models.event_listing_candidate import (
    CandidateIngestionOutcome,
    CandidateStatus,
    EventListingCandidate,
    EventListingCandidateIngestionAudit,
)
from app.models.user import User
from app.services import api_credentials


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
        "vibes": ["career", "social"],
        "location_name": "The Nest",
        "event_date": "2026-09-01T18:00:00Z",
        "event_end_date": "2026-09-01T20:00:00Z",
        "source_type": "instagram",
        "external_source_id": external_source_id,
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


async def _mint_credential(
    client: AsyncClient, label: str = "Candidate importer"
) -> tuple[dict, str]:
    response = await client.post("/admin/api-keys", json={"label": label})
    assert response.status_code == 201, response.text
    payload = response.json()
    return payload, payload["raw_token"]


def _api_key_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Api-Key {token}"}


async def _insert_credential(
    db_session: AsyncSession, test_user: User, label: str = "Candidate importer"
) -> tuple[ApiCredential, str]:
    secret = api_credentials.generate_secret()
    credential = ApiCredential(
        label=label,
        secret_hash=api_credentials.hash_secret(secret),
        created_by_user_id=test_user.id,
    )
    db_session.add(credential)
    await db_session.flush()
    return credential, api_credentials.format_token(credential.id, secret)


class TestCandidateIngestionAuthorization:
    async def test_candidate_ingestion_requires_its_machine_credential(
        self, unauthed_client: AsyncClient
    ):
        missing = await unauthed_client.post(
            "/ingestion/event-candidates", json=_payload()
        )
        wrong_scheme = await unauthed_client.post(
            "/ingestion/event-candidates",
            headers={"Authorization": "Bearer leftover"},
            json=_payload("post-wrong-scheme"),
        )
        malformed = await unauthed_client.post(
            "/ingestion/event-candidates",
            headers={"Authorization": "Api-Key not-a-managed-token"},
            json=_payload("post-wrong-key"),
        )

        assert missing.status_code == 401
        assert wrong_scheme.status_code == 403
        assert malformed.status_code == 403

    async def test_candidate_credential_cannot_access_admin_operations(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
        test_user: User,
    ):
        _credential, token = await _insert_credential(db_session, test_user)
        headers = _api_key_headers(token)

        events = await unauthed_client.get("/admin/events", headers=headers)
        candidates = await unauthed_client.get("/admin/candidates", headers=headers)
        api_keys = await unauthed_client.get("/admin/api-keys", headers=headers)

        assert events.status_code == 403
        assert candidates.status_code == 403
        assert api_keys.status_code == 403

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
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        created, token = await _mint_credential(credential_admin_client)
        response = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json=_payload(),
        )

        assert response.status_code == 201
        data = response.json()
        assert data["outcome"] == "created"
        assert data["candidate"]["title"] == "Campus Candidate"
        assert data["candidate"]["source_type"] == "instagram"
        assert data["candidate"]["extraction_confidence"] == 0.91
        assert data["candidate"]["extraction_output"]["location_name"] == "The Nest"

        candidate = await db_session.get(EventListingCandidate, data["candidate"]["id"])
        assert candidate is not None
        assert candidate.extraction_metadata["extractor_version"] == "2026-08-08"
        assert candidate.description == "A useful campus event description."
        assert candidate.status == CandidateStatus.PENDING

        audit = await db_session.get(
            EventListingCandidateIngestionAudit, data["receipt_id"]
        )
        assert audit is not None
        assert audit.candidate_id == candidate.id
        assert audit.outcome == CandidateIngestionOutcome.CREATED
        assert audit.actor_type == AuditActorType.API_KEY
        assert str(audit.actor_id) == created["id"]
        assert audit.credential_label == "Candidate importer"
        assert token not in response.text

    async def test_repeated_identity_returns_existing_and_records_outcome(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        first = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload(),
        )
        second = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload(title="Changed retry payload"),
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
        assert [audit.outcome for audit in audits.all()] == [
            CandidateIngestionOutcome.CREATED,
            CandidateIngestionOutcome.EXISTING,
        ]

    async def test_two_credentials_are_attributed_separately(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        first_credential, first_token = await _mint_credential(
            credential_admin_client, "Importer one"
        )
        second_credential, second_token = await _mint_credential(
            credential_admin_client, "Importer two"
        )

        first = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(first_token),
            json=_payload("post-one"),
        )
        second = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(second_token),
            json=_payload("post-two"),
        )

        assert first.status_code == 201
        assert second.status_code == 201

        first_audit = await db_session.get(
            EventListingCandidateIngestionAudit, first.json()["receipt_id"]
        )
        second_audit = await db_session.get(
            EventListingCandidateIngestionAudit, second.json()["receipt_id"]
        )
        assert first_audit is not None
        assert second_audit is not None
        assert str(first_audit.actor_id) == first_credential["id"]
        assert str(second_audit.actor_id) == second_credential["id"]
        assert first_audit.credential_label == "Importer one"
        assert second_audit.credential_label == "Importer two"

    async def test_ingestion_rejects_unmodeled_fields(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        extra_content = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json={**_payload("post-extra"), "source_excerpt": "leftover excerpt"},
        )

        assert extra_content.status_code == 422

    async def test_ingestion_persists_public_contact_text(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        response = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json={
                **_payload("post-contact"),
                "description": "RSVP club@ubc.ca for details.",
                "extraction_metadata": {
                    "extractor_version": "2026-08-08",
                    "contact": "club@ubc.ca",
                },
            },
        )

        assert response.status_code == 201
        candidate = response.json()["candidate"]
        assert candidate["description"] == "RSVP club@ubc.ca for details."
        assert candidate["extraction_metadata"]["contact"] == "club@ubc.ca"


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
                status=(
                    CandidateStatus.PENDING if index < 2 else CandidateStatus.REJECTED
                ),
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
        actor_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
        audit = EventListingCandidateIngestionAudit(
            candidate_id=candidate.id,
            source_type=candidate.source_type,
            external_source_id=candidate.external_source_id,
            outcome=CandidateIngestionOutcome.CREATED,
            actor_type=AuditActorType.API_KEY,
            actor_id=actor_id,
            credential_label="Candidate importer",
        )
        db_session.add(audit)
        await db_session.flush()

        response = await admin_client.get(f"/admin/candidates/{candidate.id}")

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == str(candidate.id)
        assert data["description"] == candidate.description
        assert data["ingestion_audits"][0]["outcome"] == "created"
        assert data["ingestion_audits"][0]["actor_type"] == "api_key"
        assert data["ingestion_audits"][0]["actor_id"] == str(actor_id)
        assert data["ingestion_audits"][0]["credential_label"] == "Candidate importer"

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
        assert all(
            event["title"] != "Candidate-only title"
            for event in response.json()["events"]
        )
