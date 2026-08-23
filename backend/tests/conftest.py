"""
Shared fixtures for the UBC Discovery test suite.

Strategy:
- Alembic migrations are applied once at session start.
- Each test gets an isolated DB session using the nested-transaction
  (SAVEPOINT) pattern: the outer transaction is never committed, so
  every test's writes are fully rolled back -- including writes made
  by route handlers that call session.commit().
- AWS services (S3, Bedrock) are mocked via autouse fixture.
- Firebase token verification is mocked via autouse fixture.
- FastAPI's get_current_user dependency is overridden per-test.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
)
from sqlalchemy.orm import SessionTransaction

from alembic import command
from app.config import settings
from app.database import get_db
from app.dependencies import (
    AdminActor,
    FirebaseIdentity,
    get_current_user,
    get_firebase_identity,
    require_admin,
)
from app.models.audit_actor import AuditActorType
from app.models.event import Event
from app.models.user import User


def _mock_presigned_download_url(
    _client_method, Params=None, ExpiresIn=3600, HttpMethod=None
):
    key = (Params or {}).get("Key", "")
    return (
        f"https://s3.example.com/{key}"
        f"?X-Amz-Algorithm=AWS4-HMAC-SHA256"
        f"&X-Amz-Expires={ExpiresIn}&X-Amz-Signature=mock"
    )


# ---------------------------------------------------------------------------
# Engine (module-level singleton)
# ---------------------------------------------------------------------------
_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.database_url, echo=False)
    return _engine


# ---------------------------------------------------------------------------
# Session-scoped: apply the authoritative schema
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def _setup_tables():
    engine = _get_engine()
    async with engine.begin() as conn:

        def _upgrade(sync_connection):
            config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
            config.attributes["connection"] = sync_connection
            command.upgrade(config, "head")

        await conn.run_sync(_upgrade)
    yield
    await engine.dispose()
    global _engine
    _engine = None


# ---------------------------------------------------------------------------
# Function-scoped DB session using the SAVEPOINT pattern
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(loop_scope="session")
async def db_session(_setup_tables) -> AsyncGenerator[AsyncSession]:
    engine = _get_engine()
    conn = await engine.connect()
    txn = await conn.begin()
    await conn.begin_nested()

    session = AsyncSession(bind=conn, expire_on_commit=False)

    @event.listens_for(session.sync_session, "after_transaction_end")
    def _restart_savepoint(sess, trans: SessionTransaction):
        if conn.closed:
            return
        if not conn.in_nested_transaction():
            conn.sync_connection.begin_nested()

    yield session

    await session.close()
    await txn.rollback()
    await conn.close()


# ---------------------------------------------------------------------------
# Test data fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(loop_scope="session")
async def test_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        firebase_uid="test-uid-111",
        email="testuser@student.ubc.ca",
        preferred_name="Test User",
        major="Computer Science",
        year_standing=3,
        interests=["hiking", "coding", "photography"],
        faculty="Science",
        bio="A test user for unit tests",
        onboarding_completed=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest_asyncio.fixture(loop_scope="session")
async def other_user(db_session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        firebase_uid="test-uid-222",
        email="other@student.ubc.ca",
        preferred_name="Other User",
        major="Biology",
        year_standing=2,
        interests=["music", "cooking"],
        faculty="Science",
        bio="Another test user",
        onboarding_completed=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user


# ---------------------------------------------------------------------------
# Mock external services (autouse)
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _mock_external_services():
    """Patch external service calls so no real requests are made."""
    with (
        patch("app.services.firebase_auth.verify_id_token") as mock_firebase,
        patch(
            "app.services.firebase_auth.get_or_create_firebase_user"
        ) as mock_get_or_create,
        patch("app.services.firebase_auth.create_custom_token") as mock_custom_token,
        patch("app.services.s3._client") as mock_s3,
        patch("app.services.email.send_otp_email") as mock_email,
    ):
        mock_firebase.return_value = {
            "uid": "test-uid-111",
            "email": "testuser@student.ubc.ca",
            "name": "Test User",
            "email_verified": True,
        }

        mock_get_or_create.return_value = "test-uid-111"
        mock_custom_token.return_value = "mock-custom-token"
        mock_email.return_value = None

        s3_client = MagicMock()
        mock_s3.return_value = s3_client
        s3_client.generate_presigned_post.return_value = {
            "url": "https://s3.example.com/presigned",
            "fields": {
                "key": "profile-pictures/mock",
                "Content-Type": "image/webp",
                "policy": "mock-policy",
                "x-amz-signature": "mock-signature",
            },
        }
        s3_client.generate_presigned_url.side_effect = _mock_presigned_download_url

        yield


# ---------------------------------------------------------------------------
# HTTP clients
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(loop_scope="session")
async def client(
    db_session: AsyncSession,
    test_user: User,
) -> AsyncGenerator[AsyncClient]:
    """Authenticated async HTTP client bound to the test DB session."""
    from main import app

    async def _override_get_db():
        yield db_session

    async def _override_get_current_user():
        return test_user

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def onboarding_client(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient]:
    """Client authenticated via Firebase token but with no DB user yet."""
    from main import app

    async def _override_get_db():
        yield db_session

    async def _override_get_firebase_identity():
        return FirebaseIdentity(
            uid="new-user-uid-999",
            email="newuser@student.ubc.ca",
            name="New User",
        )

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_firebase_identity] = _override_get_firebase_identity

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def admin_client(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient]:
    """Admin-authenticated HTTP client for endpoints guarded by require_admin."""
    from main import app

    async def _override_get_db():
        yield db_session

    async def _override_require_admin():
        return AdminActor(
            actor_type=AuditActorType.MEMBER,
            actor_id=uuid.UUID("00000000-0000-0000-0000-000000000002"),
        )

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[require_admin] = _override_require_admin

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def credential_admin_client(
    db_session: AsyncSession,
    test_user: User,
) -> AsyncGenerator[AsyncClient]:
    """Admin client whose actor identity is backed by the test Member."""
    from main import app

    test_user.is_admin = True
    await db_session.flush()

    async def _override_get_db():
        yield db_session

    async def _override_require_admin():
        return AdminActor(actor_type=AuditActorType.MEMBER, actor_id=test_user.id)

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[require_admin] = _override_require_admin

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    test_user.is_admin = False
    await db_session.flush()
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def unauthed_client(
    db_session: AsyncSession,
) -> AsyncGenerator[AsyncClient]:
    """Unauthenticated HTTP client bound to the test DB session."""
    from main import app

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def sample_events(db_session: AsyncSession) -> list[Event]:
    """Seed a few events for listing tests."""
    events = []
    for i in range(3):
        e = Event(
            title=f"Test Event {i}",
            description=f"Description for event {i}",
            source="manual",
            source_label="ubc_official" if i == 0 else "campus_community",
            club_name=f"Club {i}",
            vibes=["social", "academic"] if i == 0 else ["social"],
            location_name=f"Location {i}",
            event_date=datetime(2026, 9, 1 + i, 10, 0, tzinfo=UTC),
            event_end_date=datetime(2026, 9, 1 + i, 13, 0, tzinfo=UTC),
        )
        db_session.add(e)
        events.append(e)
    await db_session.flush()
    return events
