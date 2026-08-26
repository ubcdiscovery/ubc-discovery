"""Integration tests for Event Listing Candidate intake and administration."""

import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_credential import ApiCredential
from app.models.audit_actor import AuditActorType
from app.models.event import Event
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
    image_content_types: list[str] | None = None,
) -> dict:
    return {
        "description": description,
        "source_account": "ubcams",
        "source_url": "https://example.com/posts/post-123",
        "source_type": "instagram",
        "external_source_id": external_source_id,
        "image_content_types": image_content_types or [],
    }


def _model_payload(external_source_id: str = "post-123") -> dict:
    payload = _payload(external_source_id)
    payload.pop("image_content_types")
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


def _assert_signed_image_url(url: str, file_key: str) -> None:
    parsed = urlparse(url)
    assert file_key in parsed.path
    query = parse_qs(parsed.query)
    assert query.get("X-Amz-Signature") == ["mock"]
    assert query.get("X-Amz-Algorithm") == ["AWS4-HMAC-SHA256"]


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
        assert data["uploads"] == []
        assert "image_keys" not in data["candidate"]
        assert "image_urls" not in data["candidate"]

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

        candidate_id = first.json()["candidate"]["id"]
        audits = await db_session.scalars(
            select(EventListingCandidateIngestionAudit)
            .where(EventListingCandidateIngestionAudit.candidate_id == candidate_id)
            .order_by(EventListingCandidateIngestionAudit.received_at)
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

    async def test_ingestion_binds_and_returns_image_uploads(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        ingested = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload(
                "carousel-123",
                image_content_types=["image/jpeg", "image/png"],
            ),
        )
        candidate_id = ingested.json()["candidate"]["id"]

        assert ingested.status_code == 201
        uploads = ingested.json()["uploads"]
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
        _assert_signed_image_url(
            detail.json()["image_urls"][0],
            f"candidates/{candidate_id}/00.jpg",
        )
        assert "image_keys" not in detail.json()

        replay = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json={
                **_payload(
                    "carousel-123",
                    image_content_types=["image/jpeg", "image/png"],
                ),
                "description": "Changed retry caption",
            },
        )
        assert replay.status_code == 200
        assert replay.json()["candidate"]["id"] == candidate_id
        assert [item["file_key"] for item in replay.json()["uploads"]] == [
            f"candidates/{candidate_id}/00.jpg",
            f"candidates/{candidate_id}/01.png",
        ]
        assert "image_urls" not in replay.json()["candidate"]

        candidate.extracted_at = datetime.now(UTC)
        await db_session.flush()
        completed = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload(
                "carousel-123",
                image_content_types=["image/jpeg", "image/png"],
            ),
        )
        assert completed.status_code == 200
        assert completed.json()["candidate"]["id"] == candidate_id
        assert completed.json()["uploads"] == []

    async def test_repeated_ingestion_rejects_conflicting_image_intent(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        first = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json={
                **_payload("carousel-conflict"),
                "image_content_types": ["image/jpeg", "image/png"],
            },
        )
        conflict = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json={
                **_payload("carousel-conflict"),
                "image_content_types": ["image/webp"],
            },
        )

        assert first.status_code == 201
        assert conflict.status_code == 409

    async def test_retry_reuses_legacy_uuid_shaped_keys_exactly(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        legacy_key = "candidates/11111111-1111-1111-1111-111111111111/00.jpg"
        candidate = EventListingCandidate(
            id="legacy01",
            **_model_payload("legacy-image-retry"),
            image_keys=[legacy_key],
        )
        db_session.add(candidate)
        await db_session.flush()
        calls: list[tuple[str, str]] = []

        def presign(*, content_type, file_key, max_file_size_bytes):
            calls.append((content_type, file_key))
            return "https://s3.example.com/legacy", {}, file_key

        monkeypatch.setattr(
            "app.routers.ingestion.candidates.s3.generate_presigned_upload_url",
            presign,
        )
        response = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json=_payload("legacy-image-retry", image_content_types=["image/jpeg"]),
        )
        assert response.status_code == 200, response.text
        assert calls == [("image/jpeg", legacy_key)]
        assert response.json()["uploads"][0]["file_key"] == legacy_key

    async def test_ingestion_retries_candidate_id_collision_and_exhausts(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch,
    ):
        _created, token = await _mint_credential(credential_admin_client)
        db_session.add(
            EventListingCandidate(
                id="event001",
                **_model_payload("occupied-candidate-id"),
            )
        )
        await db_session.flush()
        assert await db_session.get(EventListingCandidate, "event001") is not None
        generated = iter(["event001", "new00001"])

        async def next_generated(_session):
            return next(generated)

        monkeypatch.setattr(
            "app.routers.ingestion.candidates.generate_unique_id", next_generated
        )
        retry_source = f"collision-retry-{uuid.uuid4().hex}"
        response = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json=_payload(retry_source),
        )
        assert response.status_code == 201, response.text
        assert response.json()["candidate"]["id"] == "new00001"

        async def repeat_existing(_session):
            return "event001"

        monkeypatch.setattr(
            "app.routers.ingestion.candidates.generate_unique_id", repeat_existing
        )
        exhausted = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=_api_key_headers(token),
            json=_payload(f"collision-exhausted-{uuid.uuid4().hex}"),
        )
        assert exhausted.status_code == 409
        assert exhausted.json()["detail"] == "Could not allocate a unique Candidate id"

    async def test_shared_id_generator_skips_event_and_candidate_ids(
        self,
        db_session: AsyncSession,
        monkeypatch,
    ):
        db_session.add_all(
            [
                Event(
                    id="event002",
                    title="Existing Event",
                    source="manual",
                    source_label="campus_community",
                    location_name="Nest",
                    event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
                ),
                EventListingCandidate(
                    id="cand0002",
                    **_model_payload("occupied-candidate"),
                ),
            ]
        )
        await db_session.flush()
        generated = iter(["event002", "cand0002", "free0001"])
        monkeypatch.setattr("app.services.ids.generate", lambda size: next(generated))
        from app.services.ids import generate_unique_id

        assert await generate_unique_id(db_session) == "free0001"

    async def test_ingestion_validates_image_content_types(
        self, credential_admin_client: AsyncClient
    ):
        _created, token = await _mint_credential(credential_admin_client)
        headers = _api_key_headers(token)
        missing = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json={
                key: value
                for key, value in _payload("post-missing-images").items()
                if key != "image_content_types"
            },
        )
        caption_only = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload("post-caption-only", image_content_types=[]),
        )
        too_many = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload("post-too-many", image_content_types=["image/jpeg"] * 11),
        )
        unsupported_type = await credential_admin_client.post(
            "/ingestion/event-candidates",
            headers=headers,
            json=_payload("post-gif", image_content_types=["image/gif"]),
        )

        assert missing.status_code == 422
        assert caption_only.status_code == 201
        assert caption_only.json()["uploads"] == []
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
        assert "image_urls" not in caption_only.json()["candidate"]
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
                source_type="instagram-queue" if index < 2 else "calendar-queue",
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
                "source_type": "instagram-queue",
                "skip": 1,
                "limit": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert len(data["candidates"]) == 1
        assert data["candidates"][0]["source_type"] == "instagram-queue"

    async def test_admin_can_inspect_candidate_and_audit_history(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        candidate_id = "legacy01"
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
        _assert_signed_image_url(
            data["image_urls"][0],
            f"candidates/{candidate.id}/00.jpg",
        )
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
