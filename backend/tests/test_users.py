"""
Tests for the /users endpoints.

Covers:
- GET /users/me - fetch own profile
- POST /users/onboarding - create user on onboarding
- PUT /users/me - update profile
- GET /users/me/presigned-upload - S3 presigned POST
- GET /users/me/stats - user statistics
"""

from httpx import AsyncClient

from app.models.user import User


class TestGetMe:
    async def test_get_me_returns_profile(self, client: AsyncClient, test_user: User):
        resp = await client.get("/users/me")
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == test_user.email
        assert data["preferred_name"] == test_user.preferred_name
        assert data["major"] == "Computer Science"

    async def test_get_me_includes_expected_fields(self, client: AsyncClient):
        resp = await client.get("/users/me")
        data = resp.json()
        expected_fields = {
            "id",
            "email",
            "preferred_name",
            "major",
            "year_standing",
            "interests",
            "faculty",
            "bio",
            "profile_picture_url",
            "created_at",
        }
        assert expected_fields.issubset(data.keys())


class TestOnboarding:
    async def test_complete_onboarding_creates_user(
        self, onboarding_client: AsyncClient
    ):
        resp = await onboarding_client.post(
            "/users/onboarding",
            json={
                "preferred_name": "New User",
                "major": "Physics",
                "year_standing": 2,
                "interests": ["stargazing", "gaming"],
                "faculty": "Science",
                "bio": "Love physics!",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["preferred_name"] == "New User"
        assert data["major"] == "Physics"
        assert data["year_standing"] == 2
        assert data["email"] == "newuser@student.ubc.ca"

    async def test_onboarding_duplicate_returns_409(
        self, onboarding_client: AsyncClient
    ):
        await onboarding_client.post(
            "/users/onboarding",
            json={"preferred_name": "New User"},
        )
        resp = await onboarding_client.post(
            "/users/onboarding",
            json={"preferred_name": "New User"},
        )
        assert resp.status_code == 409


class TestUpdateProfile:
    async def test_update_preferred_name(self, client: AsyncClient):
        resp = await client.put(
            "/users/me",
            json={"preferred_name": "Updated Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["preferred_name"] == "Updated Name"

    async def test_update_multiple_fields(self, client: AsyncClient):
        resp = await client.put(
            "/users/me",
            json={
                "bio": "New bio here",
                "interests": ["swimming", "reading"],
                "year_standing": 4,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["bio"] == "New bio here"
        assert data["interests"] == ["swimming", "reading"]
        assert data["year_standing"] == 4

    async def test_clear_optional_academic_context(self, client: AsyncClient):
        resp = await client.put(
            "/users/me",
            json={"faculty": None, "major": None, "year_standing": None},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["faculty"] is None
        assert data["major"] is None
        assert data["year_standing"] is None


class TestPresignedUpload:
    async def test_get_presigned_upload_url(self, client: AsyncClient):
        resp = await client.get("/users/me/presigned-upload")
        assert resp.status_code == 200
        data = resp.json()
        assert "upload_url" in data
        assert "fields" in data
        assert data["fields"]["Content-Type"] == "image/webp"
        assert "file_key" in data
        assert data["max_file_size_bytes"] == 512 * 1024


class TestUserStats:
    async def test_get_stats(self, client: AsyncClient):
        resp = await client.get("/users/me/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "member_since" in data
