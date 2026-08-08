from __future__ import annotations

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.models.event import Event

_MIGRATION_PATH = (
    Path(__file__).parents[1]
    / "alembic"
    / "versions"
    / "0002_add_event_embedding_vector.py"
)
_MIGRATION_SPEC = importlib.util.spec_from_file_location(
    "event_embedding_migration", _MIGRATION_PATH
)
assert _MIGRATION_SPEC is not None and _MIGRATION_SPEC.loader is not None
_EMBEDDING_MIGRATION = importlib.util.module_from_spec(_MIGRATION_SPEC)
_MIGRATION_SPEC.loader.exec_module(_EMBEDDING_MIGRATION)


def _embedding(first_value: float = 1.0, second_value: float = 0.0) -> list[float]:
    return [first_value, second_value, *([0.0] * (EVENT_EMBEDDING_DIMENSIONS - 2))]


class TestEmbeddingMigration:
    async def test_vector_extension_and_dimension(self, db_session: AsyncSession):
        extension = await db_session.scalar(
            text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
        )
        assert extension == 1

        vector_type = await db_session.scalar(
            text(
                """
                SELECT format_type(a.atttypid, a.atttypmod)
                FROM pg_attribute AS a
                JOIN pg_class AS c ON c.oid = a.attrelid
                WHERE c.relname = 'events' AND a.attname = 'embedding_vector'
                """
            )
        )
        assert vector_type == f"vector({EVENT_EMBEDDING_DIMENSIONS})"

    async def test_backfill_copies_valid_json_embeddings(
        self, db_session: AsyncSession
    ):
        event = Event(
            title="Backfill me",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
            embedding=_embedding(),
        )
        db_session.add(event)
        await db_session.flush()

        await db_session.run_sync(_EMBEDDING_MIGRATION.backfill_event_embeddings)
        await db_session.refresh(event)

        assert event.embedding_vector == event.embedding

    async def test_backfill_fails_with_actionable_invalid_embedding(
        self, db_session: AsyncSession
    ):
        event = Event(
            title="Malformed embedding",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
            embedding=[0.1, 0.2],
        )
        db_session.add(event)
        await db_session.flush()

        with pytest.raises(RuntimeError, match=f"{event.id}.*expected"):
            await db_session.run_sync(_EMBEDDING_MIGRATION.backfill_event_embeddings)

    async def test_cosine_distance_retrieval_uses_vector_storage(
        self, db_session: AsyncSession
    ):
        nearest = Event(
            title="Nearest",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
            embedding=_embedding(),
            embedding_vector=_embedding(),
        )
        orthogonal = Event(
            title="Orthogonal",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 2, 10, tzinfo=UTC),
            embedding=_embedding(0.0, 1.0),
            embedding_vector=_embedding(0.0, 1.0),
        )
        db_session.add_all([orthogonal, nearest])
        await db_session.flush()

        query_vector = _embedding()
        result = await db_session.execute(
            select(Event)
            .where(Event.id.in_([nearest.id, orthogonal.id]))
            .order_by(Event.embedding_vector.cosine_distance(query_vector))
        )

        assert [event.id for event in result.scalars()] == [nearest.id, orthogonal.id]
