"""Integration tests for protected Event Listing administration."""

from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.models.event import Event
from app.models.user import User

ADMIN_HEADERS = {"Authorization": "Bearer test-token"}


def _test_embedding(first_value: float = 0.0) -> list[float]:
    return [first_value] + [0.0] * (EVENT_EMBEDDING_DIMENSIONS - 1)


class TestAdminAuthorization:
    async def test_admin_events_require_authentication(
        self, unauthed_client: AsyncClient
    ):
        resp = await unauthed_client.get("/admin/events")
        assert resp.status_code == 401

    async def test_non_admin_cannot_read_admin_catalogue(self, client: AsyncClient):
        resp = await client.get("/admin/events", headers=ADMIN_HEADERS)
        assert resp.status_code == 403

    async def test_non_admin_cannot_invoke_event_mutations(
        self, client: AsyncClient, sample_events: list[Event]
    ):
        event_id = sample_events[0].id
        requests = (
            ("POST", "/admin/events", {"title": "Nope"}),
            ("PUT", f"/admin/events/{event_id}", {"title": "Nope"}),
            ("DELETE", f"/admin/events/{event_id}", None),
            ("POST", f"/admin/events/{event_id}/presigned-upload", None),
        )

        for method, path, body in requests:
            resp = await client.request(
                method,
                path,
                headers=ADMIN_HEADERS,
                json=body,
            )
            assert resp.status_code == 403

    async def test_database_admin_can_access_admin_events(
        self,
        client: AsyncClient,
        test_user: User,
        db_session: AsyncSession,
    ):
        test_user.is_admin = True
        await db_session.flush()
        try:
            resp = await client.get("/admin/events", headers=ADMIN_HEADERS)
            assert resp.status_code == 200
        finally:
            test_user.is_admin = False
            await db_session.flush()

    async def test_admin_api_key_can_access_admin_events(
        self, unauthed_client: AsyncClient
    ):
        with patch("app.dependencies.settings.admin_api_key", "test-admin-key"):
            resp = await unauthed_client.get(
                "/admin/events",
                headers={"Authorization": "Api-Key test-admin-key"},
                params={"q": "no matching records"},
            )
        assert resp.status_code == 200

    async def test_old_event_mutation_routes_are_removed(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        event_id = sample_events[0].id
        requests = (
            ("POST", "/events", 405),
            ("PUT", f"/events/{event_id}", 405),
            ("DELETE", f"/events/{event_id}", 405),
            ("POST", f"/events/{event_id}/presigned-upload", 404),
        )
        for method, path, expected_status in requests:
            resp = await unauthed_client.request(method, path, json={})
            assert resp.status_code == expected_status


class TestAdminEventList:
    async def test_paginates_admin_event_list(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        marker = "Admin pagination event"
        page_one_events = [
            Event(
                title=f"{marker} {index}",
                source="manual",
                location_name="Known location",
                event_date=datetime(2026, 9, 1, tzinfo=ZoneInfo("UTC")),
            )
            for index in range(25)
        ]
        page_two_event = Event(
            title=f"{marker} page two record",
            source="manual",
            location_name="TBA",
            event_date=datetime(2026, 8, 1, tzinfo=ZoneInfo("UTC")),
        )
        db_session.add_all([*page_one_events, page_two_event])
        await db_session.flush()

        resp = await admin_client.get(
            "/admin/events",
            params={"q": marker, "skip": 25, "limit": 25},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 26
        assert [event["id"] for event in data["events"]] == [page_two_event.id]
        assert data["events"][0]["location_name"] == "TBA"

    async def test_list_includes_past_and_upcoming_events(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        now = datetime.now(ZoneInfo("UTC"))
        past_event = Event(
            title="Admin timeline marker past",
            source="manual",
            location_name="Old Auditorium",
            event_date=now - timedelta(days=30),
        )
        upcoming_event = Event(
            title="Admin timeline marker upcoming",
            source="manual",
            location_name="New Auditorium",
            event_date=now + timedelta(days=30),
        )
        db_session.add_all([past_event, upcoming_event])
        await db_session.flush()

        resp = await admin_client.get(
            "/admin/events", params={"q": "Admin timeline marker", "limit": 100}
        )

        assert resp.status_code == 200
        data = resp.json()
        ids = [event["id"] for event in data["events"]]
        assert past_event.id in ids
        assert upcoming_event.id in ids
        assert data["total"] == 2

    async def test_status_filter_finds_archived_records(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        archived = Event(
            title="Archived catalogue record",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, tzinfo=ZoneInfo("UTC")),
            is_archived=True,
        )
        active = Event(
            title="Active catalogue record",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 2, tzinfo=ZoneInfo("UTC")),
        )
        db_session.add_all([archived, active])
        await db_session.flush()

        archived_resp = await admin_client.get(
            "/admin/events", params={"status": "archived", "q": "catalogue record"}
        )
        active_resp = await admin_client.get(
            "/admin/events", params={"status": "active", "q": "catalogue record"}
        )

        assert [item["id"] for item in archived_resp.json()["events"]] == [archived.id]
        assert [item["id"] for item in active_resp.json()["events"]] == [active.id]

    async def test_searches_canonical_events_and_reports_total(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        event = Event(
            title="Distinctive Admin Search Result",
            description="Only the protected catalogue should find this.",
            source="manual",
            location_name="Search Hall",
            event_date=datetime.now(ZoneInfo("UTC")) - timedelta(days=1),
        )
        db_session.add(event)
        await db_session.flush()

        resp = await admin_client.get(
            "/admin/events", params={"q": "Distinctive Admin", "limit": 25}
        )

        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["events"][0]["id"] == event.id

    async def test_get_admin_event(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await admin_client.get(f"/admin/events/{sample_events[0].id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == sample_events[0].id

    async def test_get_admin_event_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.get("/admin/events/notfound")
        assert resp.status_code == 404


class TestCreateAdminEvent:
    async def test_create_event_success(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/admin/events",
            json={
                "title": "My New Event",
                "description": "A cool gathering",
                "club_name": "Coding Club",
                "source_label": "ams_club",
                "source_url": "https://example.com/event",
                "external_cta_label": "View registration",
                "vibes": ["career", "social"],
                "location_name": "The Nest",
                "event_date": "2026-09-01T10:00:00Z",
                "event_end_date": "2026-09-01T13:00:00Z",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "My New Event"
        assert data["source"] == "manual"
        assert data["source_label"] == "ams_club"
        assert data["vibes"] == ["career", "social"]

    async def test_create_event_writes_json_and_vector_embeddings(
        self, admin_client: AsyncClient, db_session: AsyncSession
    ):
        embedding = _test_embedding(0.1)
        with patch(
            "app.routers.admin.events.recommender.generate_event_embedding",
            return_value=embedding,
        ):
            resp = await admin_client.post(
                "/admin/events",
                json={
                    "title": "Vector-backed Event",
                    "location_name": "The Nest",
                    "event_date": "2026-09-01T10:00:00Z",
                },
            )

        assert resp.status_code == 200
        event = await db_session.get(Event, resp.json()["id"])
        assert event is not None
        assert event.embedding == embedding
        assert event.embedding_vector == embedding

    async def test_create_preserves_free_form_ingestion_source(
        self, admin_client: AsyncClient
    ):
        resp = await admin_client.post(
            "/admin/events",
            json={
                "title": "Imported Event",
                "source": "ubc_calendar",
                "location_name": "To be announced",
                "event_date": "2026-09-01T10:00:00Z",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["source"] == "ubc_calendar"

    async def test_create_rejects_invalid_taxonomy_and_location(
        self, admin_client: AsyncClient
    ):
        invalid_payloads = (
            {"vibes": ["invented"], "location_name": "The Nest"},
            {"source_label": "other", "location_name": "The Nest"},
            {"location_name": "   "},
        )
        for fields in invalid_payloads:
            resp = await admin_client.post(
                "/admin/events",
                json={
                    "title": "Invalid Event",
                    "event_date": "2026-09-01T10:00:00Z",
                    **fields,
                },
            )
            assert resp.status_code == 422

    async def test_create_rejects_end_before_start(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/admin/events",
            json={
                "title": "Bad Dates",
                "location_name": "The Nest",
                "event_date": "2026-09-01T14:00:00Z",
                "event_end_date": "2026-09-01T10:00:00Z",
            },
        )
        assert resp.status_code == 422


class TestUpdateAdminEvent:
    async def test_partial_update_preserves_omitted_fields(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        with patch(
            "app.routers.admin.events.recommender.generate_event_embedding"
        ) as mock_embedding:
            mock_embedding.return_value = _test_embedding(0.1)
            resp = await admin_client.put(
                f"/admin/events/{event.id}",
                json={"title": "Updated Event Title"},
            )

        assert resp.status_code == 200
        assert resp.json()["title"] == "Updated Event Title"
        assert resp.json()["description"] == event.description
        mock_embedding.assert_called_once()

    async def test_non_embedding_change_skips_embedding_regeneration(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        with patch(
            "app.routers.admin.events.recommender.generate_event_embedding"
        ) as mock_embedding:
            resp = await admin_client.put(
                f"/admin/events/{sample_events[0].id}",
                json={"source_url": "https://example.com/updated"},
            )
        assert resp.status_code == 200
        mock_embedding.assert_not_called()

    async def test_full_form_update_skips_unchanged_embedding_inputs(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        assert event.event_end_date is not None
        payload = {
            "title": event.title,
            "description": event.description,
            "club_name": event.club_name,
            "location_name": event.location_name,
            "event_date": event.event_date.isoformat(),
            "event_end_date": event.event_end_date.isoformat(),
            "source_label": event.source_label,
            "source_url": "https://example.com/updated",
            "vibes": event.vibes,
        }
        with patch(
            "app.routers.admin.events.recommender.generate_event_embedding"
        ) as mock_embedding:
            resp = await admin_client.put(
                f"/admin/events/{event.id}",
                json=payload,
            )

        assert resp.status_code == 200
        assert resp.json()["source_url"] == payload["source_url"]
        mock_embedding.assert_not_called()

    async def test_update_rejects_invalid_values(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event_id = sample_events[0].id
        for payload in (
            {"vibes": ["invented"]},
            {"source_label": "other"},
            {"location_name": None},
            {"location_name": "  "},
            {"event_end_date": "2026-08-01T10:00:00Z"},
            {"event_date": "2026-10-01T10:00:00Z"},
        ):
            resp = await admin_client.put(f"/admin/events/{event_id}", json=payload)
            assert resp.status_code == 422

    async def test_update_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.put("/admin/events/notfound", json={"title": "Nope"})
        assert resp.status_code == 404


class TestArchiveAdminEvent:
    async def test_delete_event_archives_without_deleting_history(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        event = Event(
            title="Archive Me",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, 0, tzinfo=ZoneInfo("UTC")),
        )
        db_session.add(event)
        await db_session.flush()
        event_id = event.id

        resp = await admin_client.delete(f"/admin/events/{event_id}")

        assert resp.status_code == 204
        await db_session.refresh(event)
        assert event.is_archived is True
        assert event.archived_at is not None

        public_resp = await admin_client.get(f"/admin/events/{event_id}/audit")
        assert public_resp.status_code == 200
        assert public_resp.json()["entries"][-1]["action"] == "archive"

    async def test_archive_and_restore_are_explicit_and_audited(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]

        archived = await admin_client.post(f"/admin/events/{event.id}/archive")
        assert archived.status_code == 200
        assert archived.json()["is_archived"] is True

        restored = await admin_client.post(f"/admin/events/{event.id}/restore")
        assert restored.status_code == 200
        assert restored.json()["is_archived"] is False

        audit = await admin_client.get(f"/admin/events/{event.id}/audit")
        assert audit.status_code == 200
        assert [entry["action"] for entry in audit.json()["entries"][-2:]] == [
            "archive",
            "restore",
        ]
class TestAdminEventPresignedUpload:
    async def test_get_event_presigned_upload_url(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        resp = await admin_client.post(f"/admin/events/{event.id}/presigned-upload")
        assert resp.status_code == 200
        data = resp.json()
        assert data["upload_url"] == "https://s3.example.com/presigned"
        assert data["file_key"] == f"event-pictures/{event.id}.webp"
        assert data["max_file_size_bytes"] == 3 * 1024 * 1024

        audit = await admin_client.get(f"/admin/events/{event.id}/audit")
        assert audit.json()["entries"][-1]["action"] == "image_upload"

    async def test_event_presigned_upload_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.post("/admin/events/notfound/presigned-upload")
        assert resp.status_code == 404
