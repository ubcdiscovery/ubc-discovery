"""The local-development auth bypass must stay inert unless explicitly asked for.

These tests exist to make sure a stray AUTH_DEV_BYPASS can never forge an
identity in an environment that has a real Firebase project configured.
"""

import pytest

from app.config import settings
from app.dependencies import _dev_identity

VALID_TOKEN = "mock-token:dev-uid:dev@student.ubc.ca"


@pytest.fixture
def bypass_enabled(monkeypatch):
    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "firebase_credentials_json", "")


def test_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "auth_dev_bypass", False)
    monkeypatch.setattr(settings, "firebase_credentials_json", "")

    assert _dev_identity(VALID_TOKEN) is None


def test_ignored_when_firebase_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "auth_dev_bypass", True)
    monkeypatch.setattr(settings, "firebase_credentials_json", '{"type":"x"}')

    assert _dev_identity(VALID_TOKEN) is None


def test_accepts_a_development_token(bypass_enabled):
    identity = _dev_identity(VALID_TOKEN)

    assert identity is not None
    assert identity.uid == "dev-uid"
    assert identity.email == "dev@student.ubc.ca"


@pytest.mark.parametrize(
    "token",
    [
        "",
        "not-a-token",
        "mock-token",
        "mock-token:only-uid",
        "mock-token::missing-uid@x.ca",
        "mock-token:uid-without-email:",
        "eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.payload.signature",
    ],
)
def test_rejects_anything_that_is_not_a_development_token(bypass_enabled, token):
    assert _dev_identity(token) is None


class TestAdminGuardWithDevIdentity:
    """The bypass must never be a route to admin on its own."""

    async def test_dev_token_without_admin_flag_is_refused(
        self, unauthed_client, db_session, test_user, monkeypatch
    ):
        monkeypatch.setattr(settings, "auth_dev_bypass", True)
        monkeypatch.setattr(settings, "firebase_credentials_json", "")

        response = await unauthed_client.get(
            "/event-submissions",
            headers={"Authorization": f"Bearer mock-token:{test_user.firebase_uid}:x@y.ca"},
        )

        assert response.status_code == 403

    async def test_dev_token_with_admin_flag_is_allowed(
        self, unauthed_client, db_session, test_user, monkeypatch
    ):
        monkeypatch.setattr(settings, "auth_dev_bypass", True)
        monkeypatch.setattr(settings, "firebase_credentials_json", "")
        test_user.is_admin = True
        await db_session.flush()

        response = await unauthed_client.get(
            "/event-submissions",
            headers={"Authorization": f"Bearer mock-token:{test_user.firebase_uid}:x@y.ca"},
        )

        assert response.status_code == 200
