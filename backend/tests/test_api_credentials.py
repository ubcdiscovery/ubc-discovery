"""Integration coverage for managed API credential foundations."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_candidate_ingester
from app.models.api_credential import ApiCredential, ApiCredentialAuditLog


async def _create_credential(
    client: AsyncClient, label: str, expires_at: datetime | None = None
) -> tuple[dict, str]:
    body = {"label": label}
    if expires_at is not None:
        body["expires_at"] = expires_at.isoformat()
    response = await client.post("/admin/api-keys", json=body)
    assert response.status_code == 201, response.text
    payload = response.json()
    return payload, payload["raw_token"]


class TestApiCredentialLifecycle:
    async def test_create_returns_secret_once_and_listing_is_metadata_only(
        self,
        credential_admin_client: AsyncClient,
        test_user,
    ):
        created, raw_token = await _create_credential(
            credential_admin_client, "Calendar importer"
        )

        assert created["label"] == "Calendar importer"
        assert created["created_by_user_id"] == str(test_user.id)
        assert created["status"] == "active"
        assert raw_token.startswith(f"ubc_live_{created['id']}.")

        listing = await credential_admin_client.get("/admin/api-keys")
        assert listing.status_code == 200
        listed = listing.json()["credentials"][0]
        assert listed["id"] == created["id"]
        assert "raw_token" not in listed
        assert "secret_hash" not in listed
        assert raw_token not in listing.text

    async def test_replacement_and_revocation_are_audited(
        self,
        credential_admin_client: AsyncClient,
    ):
        created, raw_token = await _create_credential(
            credential_admin_client, "Rotating importer"
        )
        replacement = await credential_admin_client.post(
            f"/admin/api-keys/{created['id']}/replace",
            json={"label": "Rotating importer replacement"},
        )
        assert replacement.status_code == 201
        replacement_data = replacement.json()
        assert replacement_data["raw_token"] != raw_token

        revoked = await credential_admin_client.post(
            f"/admin/api-keys/{created['id']}/revoke"
        )
        assert revoked.status_code == 200
        assert revoked.json()["status"] == "revoked"

        audit_response = await credential_admin_client.get(
            f"/admin/api-keys/{created['id']}/audit"
        )
        assert [entry["action"] for entry in audit_response.json()["entries"]] == [
            "create",
            "replace",
            "revoke",
        ]
        assert raw_token not in audit_response.text

    async def test_managed_token_dependency_tracks_last_use_and_rejects_revocation(
        self,
        credential_admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        created, token = await _create_credential(
            credential_admin_client, "Dependency importer"
        )

        actor = await require_candidate_ingester(f"Api-Key {token}", db_session)
        assert actor.actor_type == "api_key"
        assert str(actor.actor_id) == created["id"]
        await db_session.flush()

        credential = await db_session.get(ApiCredential, uuid.UUID(created["id"]))
        assert credential is not None and credential.last_used_at is not None

        await credential_admin_client.post(f"/admin/api-keys/{created['id']}/revoke")
        with pytest.raises(HTTPException, match="Invalid API credential") as error:
            await require_candidate_ingester(f"Api-Key {token}", db_session)
        assert error.value.status_code == 403

    async def test_expired_token_is_rejected(self, credential_admin_client, db_session):
        created, token = await _create_credential(
            credential_admin_client,
            "Temporary importer",
            datetime.now(UTC) + timedelta(minutes=5),
        )
        credential = await db_session.get(ApiCredential, uuid.UUID(created["id"]))
        assert credential is not None
        credential.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.flush()

        with pytest.raises(HTTPException) as error:
            await require_candidate_ingester(f"Api-Key {token}", db_session)
        assert error.value.status_code == 403


class TestApiCredentialBoundaries:
    async def test_api_key_cannot_manage_credentials(
        self, unauthed_client: AsyncClient
    ):
        response = await unauthed_client.get(
            "/admin/api-keys",
            headers={"Authorization": "Api-Key ubc_live_not-an-admin-token"},
        )
        assert response.status_code == 403

    async def test_ordinary_member_cannot_manage_credentials(self, client: AsyncClient):
        response = await client.post(
            "/admin/api-keys",
            headers={"Authorization": "Bearer test-token"},
            json={"label": "Should fail"},
        )
        assert response.status_code == 403

    async def test_audit_action_check_rejects_unknown_values(
        self, db_session: AsyncSession, test_user
    ):
        credential = ApiCredential(
            label="Constraint test",
            secret_hash="scrypt$test",
            created_by_user_id=test_user.id,
        )
        db_session.add(credential)
        await db_session.flush()

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                db_session.add(
                    ApiCredentialAuditLog(
                        credential_id=credential.id,
                        actor_type="member",
                        actor_id=test_user.id,
                        action="unknown",
                    )
                )
                await db_session.flush()
