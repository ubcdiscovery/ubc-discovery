"""
Tests for the /events endpoints.

Covers public Event Listing discovery and detail endpoints.
"""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from httpx import AsyncClient
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

    async def test_archived_event_is_not_publicly_discoverable(
        self,
        unauthed_client: AsyncClient,
        db_session: AsyncSession,
    ):
        event = Event(
            title="Archived public event",
            source="manual",
            location_name="The Nest",
            event_date=datetime.now(ZoneInfo("UTC")) + timedelta(days=1),
            is_archived=True,
        )
        db_session.add(event)
        await db_session.flush()

        detail = await unauthed_client.get(f"/events/{event.id}")
        listing = await unauthed_client.get("/events")

        assert detail.status_code == 404
        assert event.id not in {item["id"] for item in listing.json()["events"]}

        search = await unauthed_client.get(
            "/events/search", params={"q": "Archived public event"}
        )
        assert search.status_code == 200
        assert event.id not in {item["id"] for item in search.json()["events"]}


class TestSearchEvents:
    async def test_search_events_only_returns_upcoming_matches(
        self, unauthed_client: AsyncClient, db_session: AsyncSession
    ):
        current_time = datetime.now(ZoneInfo("America/Vancouver"))
        future_event = Event(
            title="Campus Search Match",
            description="Upcoming searchable event",
            source="manual",
            location_name="Main Mall",
            event_date=current_time + timedelta(days=1),
        )
        past_event = Event(
            title="Campus Search Match Past",
            description="Past searchable event",
            source="manual",
            location_name="Main Mall",
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
