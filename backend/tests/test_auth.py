from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.otp_code import OTPCode
from app.models.user import User
from app.services.email import EmailDeliveryError


class TestOTPSend:
    async def test_send_otp_success(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.post(
            "/auth/otp/send", json={"email": "user@gmail.com"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["expires_in_seconds"] == 600

    async def test_send_otp_invalid_email(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.post(
            "/auth/otp/send", json={"email": "not-an-email"}
        )
        assert resp.status_code == 422

    async def test_send_otp_delivery_failure(
        self,
        unauthed_client: AsyncClient,
        monkeypatch,
    ):
        monkeypatch.setattr(
            "app.services.email.send_otp_email",
            AsyncMock(side_effect=EmailDeliveryError("failed")),
        )

        resp = await unauthed_client.post(
            "/auth/otp/send",
            json={"email": "user@gmail.com"},
        )

        assert resp.status_code == 500
        assert resp.json()["detail"]["code"] == "OTP_DELIVERY_FAILED"

    async def test_send_otp_rate_limit(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        email = "ratelimit@test.com"
        for _ in range(3):
            otp = OTPCode(
                email=email,
                code="123456",
                expires_at=datetime.now(UTC) + timedelta(minutes=10),
            )
            db_session.add(otp)
        await db_session.flush()

        resp = await unauthed_client.post("/auth/otp/send", json={"email": email})
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "OTP_RATE_LIMITED"

    async def test_send_otp_invalidates_previous_unused_codes(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
    ):
        previous_otp = OTPCode(
            email="replacement@test.com",
            code="123456",
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        db_session.add(previous_otp)
        await db_session.flush()

        resp = await unauthed_client.post(
            "/auth/otp/send",
            json={"email": "replacement@test.com"},
        )

        assert resp.status_code == 200
        await db_session.refresh(previous_otp)
        assert previous_otp.used is True


class TestOTPVerify:
    async def _create_otp(
        self,
        db_session: AsyncSession,
        email: str = "verify@test.com",
        code: str = "123456",
    ) -> OTPCode:
        otp = OTPCode(
            email=email,
            code=code,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        db_session.add(otp)
        await db_session.flush()
        return otp

    async def test_verify_success_new_user(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        await self._create_otp(db_session, "newuser@gmail.com", "654321")
        resp = await unauthed_client.post(
            "/auth/otp/verify", json={"email": "newuser@gmail.com", "code": "654321"}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["firebase_custom_token"] == "mock-custom-token"
        assert data["is_new_user"] is True
        assert data["ubc_verified"] is False

    async def test_verify_success_ubc_email(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        await self._create_otp(db_session, "student@student.ubc.ca", "111222")
        resp = await unauthed_client.post(
            "/auth/otp/verify",
            json={"email": "student@student.ubc.ca", "code": "111222"},
        )
        assert resp.status_code == 200
        assert resp.json()["ubc_verified"] is True

    async def test_verify_reuses_existing_firebase_uid_and_backend_member(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch,
    ):
        user = User(
            firebase_uid="google-first-uid",
            email="same@example.com",
            preferred_name="Same Member",
            onboarding_completed=True,
        )
        db_session.add(user)
        await db_session.flush()
        await self._create_otp(db_session, "same@example.com", "222333")
        monkeypatch.setattr(
            "app.services.firebase_auth.get_or_create_firebase_user",
            lambda email: "google-first-uid",
        )

        resp = await unauthed_client.post(
            "/auth/otp/verify",
            json={"email": "same@example.com", "code": "222333"},
        )

        assert resp.status_code == 200
        assert resp.json()["is_new_user"] is False

    async def test_verify_does_not_reuse_member_for_a_different_email(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch,
    ):
        user = User(
            firebase_uid="existing-uid",
            email="first@example.com",
            preferred_name="Existing Member",
            onboarding_completed=True,
        )
        db_session.add(user)
        await db_session.flush()
        await self._create_otp(db_session, "second@example.com", "333444")
        monkeypatch.setattr(
            "app.services.firebase_auth.get_or_create_firebase_user",
            lambda email: "different-uid",
        )

        resp = await unauthed_client.post(
            "/auth/otp/verify",
            json={"email": "second@example.com", "code": "333444"},
        )

        assert resp.status_code == 200
        assert resp.json()["is_new_user"] is True

    async def test_verify_wrong_code(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        await self._create_otp(db_session, "wrong@test.com", "123456")
        resp = await unauthed_client.post(
            "/auth/otp/verify", json={"email": "wrong@test.com", "code": "000000"}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OTP_INVALID"

    async def test_verify_expired_code(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        otp = OTPCode(
            email="expired@test.com",
            code="123456",
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        db_session.add(otp)
        await db_session.flush()

        resp = await unauthed_client.post(
            "/auth/otp/verify", json={"email": "expired@test.com", "code": "123456"}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OTP_EXPIRED"

    async def test_verify_max_attempts(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        otp = OTPCode(
            email="maxattempts@test.com",
            code="123456",
            attempts=5,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        db_session.add(otp)
        await db_session.flush()

        resp = await unauthed_client.post(
            "/auth/otp/verify", json={"email": "maxattempts@test.com", "code": "123456"}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OTP_TOO_MANY_ATTEMPTS"

    async def test_verify_already_used(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        otp = OTPCode(
            email="used@test.com",
            code="123456",
            used=True,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        db_session.add(otp)
        await db_session.flush()

        resp = await unauthed_client.post(
            "/auth/otp/verify", json={"email": "used@test.com", "code": "123456"}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OTP_EXPIRED"
