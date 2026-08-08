from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Event
from app.models.saved_event import SavedEvent


async def test_save_event_is_idempotent(
    client: AsyncClient,
    db_session: AsyncSession,
    sample_events: list[Event],
):
    event = sample_events[0]

    created = await client.put(f"/saved-events/{event.id}")
    repeated = await client.put(f"/saved-events/{event.id}")

    assert created.status_code == 201
    assert created.headers["location"] == f"/saved-events/{event.id}"
    assert set(created.json()) == {"event_id", "saved_at"}
    assert created.json()["event_id"] == event.id
    assert repeated.status_code == 200
    assert repeated.json() == created.json()

    result = await db_session.execute(
        select(func.count())
        .select_from(SavedEvent)
        .where(SavedEvent.event_id == event.id)
    )
    assert result.scalar_one() == 1


async def test_list_saved_events_returns_event_representation(
    client: AsyncClient,
    sample_events: list[Event],
):
    event = sample_events[1]
    await client.put(f"/saved-events/{event.id}")

    response = await client.get("/saved-events")

    assert response.status_code == 200
    item = response.json()["saved_events"][0]
    assert set(item) == {"saved_at", "event"}
    assert item["event"]["id"] == event.id


async def test_unsave_event_is_idempotent(
    client: AsyncClient,
    sample_events: list[Event],
):
    event = sample_events[2]
    await client.put(f"/saved-events/{event.id}")

    deleted = await client.delete(f"/saved-events/{event.id}")
    repeated = await client.delete(f"/saved-events/{event.id}")

    assert deleted.status_code == 204
    assert repeated.status_code == 204
