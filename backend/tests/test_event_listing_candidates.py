"""Integration tests for Event Listing Candidate intake and administration."""

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select
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
    description: str = "A useful campus event description.",
) -> dict:
    return {
        "description": description,
        "source_account": "ubcams",
        "source_url": "https://example.com/posts/post-123",
        "source_type": "instagram",
        "external_source_id": external_source_id,
    }


def _model_payload(external_source_id: str = "post-123") -> dict:
    return _payload(external_source_id)


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

    async def test_candidate_image_presign_requires_its_machine_credential(
        self, unauthed_client: AsyncClient
    ):
        body = {
            "source_type": "instagram",
            "external_source_id": "post-presign-auth",
            "content_types": ["image/jpeg"],
        }
        missing = await unauthed_client.post(
            "/ingestion/event-candidates/images/presign", json=body
        )
        wrong_scheme = await unauthed_client.post(
            "/ingestion/event-candidates/images/presign",
            headers={"Authorization": "Bearer leftover"},
            json=body,
        )

        assert missing.status_code == 401
        assert wrong_scheme.status_code == 403


class TestCandidateIngestion:
    async def test_ingestion_persists_source_capture_and_audit(
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
        assert data["candidate"]["source_account"] == "ubcams"
        assert data["candidate"]["source_type"] == "instagram"

        candidate = await db_session.get(EventListingCandidate, data["candidate"]["id"])
        assert candidate is not None
        assert candidate.description == "A useful campus event description."
        assert candidate.image_keys == []
        assert candidate.status == CandidateStatus.PENDING
        assert "image_keys" not in data["candidate"]
        assert data["candidate"]["image_urls"] == []

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
            json=_payload(description="Changed retry payload"),
        )

        assert first.status_code == 201
        assert second.status_code == 200
        assert second.json()["outcome"] == "existing"
        assert second.json()["candidate"]["id"] == first.json()["candidate"]["id"]
        assert second.json()["candidate"]["description"] == (
            "A useful campus event description."
        )

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
            json={
                **_payload("post-extra"),
                "image_keys": ["candidates/leftover/00.jpg"],
            },
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
            },
        )

        assert response.status_code == 201
        candidate = response.json()["candidate"]
        assert candidate["description"] == "RSVP club@ubc.ca for details."

    async def test_image_presign_requires_an_ingested_candidate(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        missing = await credential_admin_client.post(
            "/ingestion/event-candidates/images/presign",
            headers=headers,
            json={
                "source_type": "instagram",
                "external_source_id": "carousel-123",
                "content_types": ["image/jpeg", "image/png"],
            },
        )

        assert missing.status_code == 404
        existing = await db_session.scalar(
            select(func.count()).select_from(EventListingCandidate)
        )
        assert existing == 0

    async def test_image_presign_binds_keys_to_the_candidate_id(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        ingested = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload("carousel-123"),
        )
        candidate_id = ingested.json()["candidate"]["id"]
        response = await credential_admin_client.post(
            "/ingestion/event-candidates/images/presign",
            headers=headers,
            json={
                "source_type": "instagram",
                "external_source_id": "carousel-123",
                "content_types": ["image/jpeg", "image/png"],
            },
        )

        assert ingested.status_code == 201
        assert response.status_code == 200
        uploads = response.json()["uploads"]
        assert [item["file_key"] for item in uploads] == [
            f"candidates/{candidate_id}/00.jpg",
            f"candidates/{candidate_id}/01.png",
        ]
        assert {item["upload_url"] for item in uploads} == {
            "https://s3.example.com/presigned"
        }
        assert {item["max_file_size_bytes"] for item in uploads} == {5 * 1024 * 1024}

        candidate = await db_session.get(EventListingCandidate, candidate_id)
        assert candidate is not None
        assert candidate.image_keys == [
            f"candidates/{candidate_id}/00.jpg",
            f"candidates/{candidate_id}/01.png",
        ]

        detail = await credential_admin_client.get(f"/admin/candidates/{candidate_id}")
        assert detail.json()["image_urls"][0].endswith(
            f"/candidates/{candidate_id}/00.jpg"
        )
        assert "image_keys" not in detail.json()

    async def test_image_presign_rejects_counts_outside_the_capture_cap(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        empty = await credential_admin_client.post(
            "/ingestion/event-candidates/images/presign",
            headers=headers,
            json={
                "source_type": "instagram",
                "external_source_id": "post-empty",
                "content_types": [],
            },
        )
        too_many = await credential_admin_client.post(
            "/ingestion/event-candidates/images/presign",
            headers=headers,
            json={
                "source_type": "instagram",
                "external_source_id": "post-too-many",
                "content_types": ["image/jpeg"] * 11,
            },
        )
        unsupported_type = await credential_admin_client.post(
            "/ingestion/event-candidates/images/presign",
            headers=headers,
            json={
                "source_type": "instagram",
                "external_source_id": "post-gif",
                "content_types": ["image/gif"],
            },
        )

        assert empty.status_code == 422
        assert too_many.status_code == 422
        assert unsupported_type.status_code == 422

    async def test_ingestion_accepts_caption_only_and_rejects_image_keys(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        caption_only = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload("post-caption-only"),
        )
        foreign_keys = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json={
                **_payload("post-cdn"),
                "image_keys": [
                    "https://scontent.cdninstagram.com/v/t51.2885-15/poster.jpg"
                ],
            },
        )

        assert caption_only.status_code == 201
        assert caption_only.json()["candidate"]["image_urls"] == []
        assert foreign_keys.status_code == 422


class TestAdminCandidateQueue:
    async def test_admin_can_filter_and_paginate_candidates(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        candidates = [
            EventListingCandidate(
                description=f"Queue Candidate {index}",
                source_account="ubcams",
                source_type="instagram" if index < 2 else "calendar",
                external_source_id=f"queue-{index}",
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
        candidate_id = uuid.uuid4()
        candidate = EventListingCandidate(
            id=candidate_id,
            **_model_payload(),
            image_keys=[f"candidates/{candidate_id}/00.jpg"],
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
        assert "image_keys" not in data
        assert data["image_urls"][0].endswith(f"/candidates/{candidate.id}/00.jpg")
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
                "description": "Candidate-only caption",
            }
        )
        db_session.add(candidate)
        await db_session.flush()

        response = await unauthed_client.get("/events")

        assert response.status_code == 200
        assert all(
            event["title"] != "Candidate-only caption"
            for event in response.json()["events"]
        )
