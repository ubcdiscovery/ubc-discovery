"""
Tests for the /events endpoints.

Covers:
- GET /events - list all events (paginated)
- POST /events - create a manual event (admin only)
- PUT /events/{event_id} - update an event (admin only)
- DELETE /events/{event_id} - delete an event (admin only)
- POST /events/{event_id}/presigned-upload - event image upload (admin only)
"""

from datetime import datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event


class TestListEvents:
    async def test_list_events_empty(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.get("/events")
        assert resp.status_code == 200
        data = resp.json()
        assert "events" in data
        assert isinstance(data["events"], list)

    async def test_list_events_with_data(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await unauthed_client.get("/events")
        assert resp.status_code == 200
        data = resp.json()
        titles = [e["title"] for e in data["events"]]
        assert "Test Event 0" in titles

    async def test_list_events_pagination(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await unauthed_client.get("/events", params={"skip": 0, "limit": 2})
        assert resp.status_code == 200
        assert len(resp.json()["events"]) <= 2

    async def test_list_events_skip(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await unauthed_client.get("/events", params={"skip": 100, "limit": 20})
        assert resp.status_code == 200
        assert len(resp.json()["events"]) == 0


class TestGetEvent:
    async def test_get_event_public(
        self, unauthed_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        resp = await unauthed_client.get(f"/events/{event.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == event.id
        assert len(data["id"]) == 8
        assert data["title"] == event.title
        assert data["source_label"] == event.source_label
        assert data["vibes"] == event.vibes
        assert data["event_picture_url"].endswith(f"/event-pictures/{event.id}.webp")
        assert data["event_date"] is not None
        assert data["event_end_date"] is not None

    async def test_get_event_not_found(self, unauthed_client: AsyncClient):
        resp = await unauthed_client.get("/events/notfound")
        assert resp.status_code == 404


class TestSearchEvents:
    async def test_search_events_only_returns_upcoming_matches(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        current_time = datetime.now(ZoneInfo("America/Vancouver"))
        future_event = Event(
            title="Campus Search Match",
            description="Upcoming searchable event",
            source="manual",
            event_date=current_time + timedelta(days=1),
        )
        past_event = Event(
            title="Campus Search Match Past",
            description="Past searchable event",
            source="manual",
            event_date=current_time - timedelta(days=1),
        )
        db_session.add_all([future_event, past_event])
        await db_session.flush()

        resp = await unauthed_client.get(
            "/events/search", params={"q": "Campus Search Match"}
        )

        assert resp.status_code == 200
        ids = [event["id"] for event in resp.json()["events"]]
        assert future_event.id in ids
        assert past_event.id not in ids


class TestCreateEvent:
    async def test_create_event_success(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/events",
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
        assert data["source_url"] == "https://example.com/event"
        assert data["external_cta_label"] == "View registration"
        assert data["vibes"] == ["career", "social"]
        assert data["club_name"] == "Coding Club"
        assert data["event_date"] is not None
        assert data["event_end_date"] is not None

    async def test_create_event_minimal_fields(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/events",
            json={"title": "Minimal Event", "event_date": "2026-09-01T10:00:00Z"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Minimal Event"
        assert data["description"] == ""
        assert data["source_label"] == "campus_community"
        assert data["vibes"] == []

    async def test_create_event_preserves_ingestion_source(
        self, admin_client: AsyncClient
    ):
        resp = await admin_client.post(
            "/events",
            json={
                "title": "Scraped Event",
                "source": "instagram",
                "event_date": "2026-09-01T10:00:00Z",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["source"] == "instagram"

    async def test_create_event_accepts_free_form_source(
        self, admin_client: AsyncClient
    ):
        resp = await admin_client.post(
            "/events",
            json={
                "title": "Imported Event",
                "source": "ubc_calendar",
                "event_date": "2026-09-01T10:00:00Z",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["source"] == "ubc_calendar"

    async def test_create_event_rejects_empty_source(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/events",
            json={"title": "Missing Source", "source": ""},
        )
        assert resp.status_code == 422

    async def test_create_event_rejects_unknown_vibe(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/events",
            json={"title": "Unknown Vibe", "vibes": ["invented"]},
        )
        assert resp.status_code == 422

    async def test_create_event_with_dates(self, admin_client: AsyncClient):
        resp = await admin_client.post(
            "/events",
            json={
                "title": "Future Event",
                "event_date": "2026-09-01T10:00:00Z",
                "event_end_date": "2026-09-01T12:00:00Z",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["event_date"] is not None
        assert data["event_end_date"] is not None

    async def test_create_event_rejects_end_before_start(
        self, admin_client: AsyncClient
    ):
        resp = await admin_client.post(
            "/events",
            json={
                "title": "Bad Dates",
                "event_date": "2026-09-01T14:00:00Z",
                "event_end_date": "2026-09-01T10:00:00Z",
            },
        )
        assert resp.status_code == 422


class TestUpdateEvent:
    async def test_update_event_partial_preserves_omitted_fields(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        with patch(
            "app.routers.events.recommender.generate_event_embedding"
        ) as mock_embedding:
            mock_embedding.return_value = [0.1, 0.2]
            resp = await admin_client.put(
                f"/events/{event.id}",
                json={"title": "Updated Event Title"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Updated Event Title"
        assert data["description"] == event.description
        assert data["event_picture_url"].endswith(f"/event-pictures/{event.id}.webp")
        mock_embedding.assert_called_once()

    async def test_update_event_non_embedding_field_does_not_regenerate_embedding(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        with patch(
            "app.routers.events.recommender.generate_event_embedding"
        ) as mock_embedding:
            resp = await admin_client.put(
                f"/events/{event.id}",
                json={"source_url": "https://example.com/updated"},
            )

        assert resp.status_code == 200
        assert resp.json()["source_url"] == "https://example.com/updated"
        mock_embedding.assert_not_called()

    async def test_update_event_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.put("/events/notfound", json={"title": "Nope"})
        assert resp.status_code == 404

    async def test_update_event_rejects_unknown_vibe(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await admin_client.put(
            f"/events/{sample_events[0].id}",
            json={"vibes": ["invented"]},
        )
        assert resp.status_code == 422

    async def test_update_event_rejects_end_before_existing_start(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        resp = await admin_client.put(
            f"/events/{sample_events[0].id}",
            json={"event_end_date": "2026-08-01T10:00:00Z"},
        )
        assert resp.status_code == 422


class TestDeleteEvent:
    async def test_delete_event_success(
        self,
        admin_client: AsyncClient,
        db_session: AsyncSession,
    ):
        event = Event(
            title="Delete Me",
            source="manual",
            event_date=datetime(2026, 9, 1, 10, 0, tzinfo=ZoneInfo("UTC")),
        )
        db_session.add(event)
        await db_session.flush()
        event_id = event.id

        with patch("app.routers.events.s3.delete_object") as mock_delete:
            resp = await admin_client.delete(f"/events/{event_id}")

        assert resp.status_code == 204
        mock_delete.assert_called_once_with(f"event-pictures/{event_id}.webp")
        result = await db_session.execute(select(Event).where(Event.id == event_id))
        assert result.scalar_one_or_none() is None

    async def test_delete_event_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.delete("/events/notfound")
        assert resp.status_code == 404


class TestEventPresignedUpload:
    async def test_get_event_presigned_upload_url(
        self, admin_client: AsyncClient, sample_events: list[Event]
    ):
        event = sample_events[0]
        resp = await admin_client.post(f"/events/{event.id}/presigned-upload")

        assert resp.status_code == 200
        data = resp.json()
        assert data["upload_url"] == "https://s3.example.com/presigned"
        assert data["fields"]["Content-Type"] == "image/webp"
        assert data["file_key"] == f"event-pictures/{event.id}.webp"
        assert data["max_file_size_bytes"] == 3 * 1024 * 1024

    async def test_event_presigned_upload_not_found(self, admin_client: AsyncClient):
        resp = await admin_client.post("/events/notfound/presigned-upload")
        assert resp.status_code == 404
