from __future__ import annotations

import importlib.util
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
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

_CONTRACT_PATH = (
    Path(__file__).parents[1]
    / "alembic"
    / "versions"
    / "0011_drop_legacy_event_embedding.py"
)
_CONTRACT_SPEC = importlib.util.spec_from_file_location(
    "legacy_embedding_contract", _CONTRACT_PATH
)
assert _CONTRACT_SPEC is not None and _CONTRACT_SPEC.loader is not None
_CONTRACT_MIGRATION = importlib.util.module_from_spec(_CONTRACT_SPEC)
_CONTRACT_SPEC.loader.exec_module(_CONTRACT_MIGRATION)


def _embedding(first_value: float = 1.0, second_value: float = 0.0) -> list[float]:
    return [first_value, second_value, *([0.0] * (EVENT_EMBEDDING_DIMENSIONS - 2))]


def _run_contract_upgrade(connection):
    with Operations.context(MigrationContext.configure(connection.connection())):
        _CONTRACT_MIGRATION.upgrade()


def _run_contract_downgrade(connection):
    with Operations.context(MigrationContext.configure(connection.connection())):
        _CONTRACT_MIGRATION.downgrade()


class TestEmbeddingMigration:
    def test_vector_dimension_is_pinned_in_the_migration(self):
        assert _EMBEDDING_MIGRATION.VECTOR_DIMENSIONS == 1024

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
        await db_session.execute(text("ALTER TABLE events ADD COLUMN embedding JSON"))
        event = Event(
            title="Backfill me",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
        )
        db_session.add(event)
        await db_session.flush()

        await db_session.execute(
            text("UPDATE events SET embedding = CAST(:value AS json) WHERE id = :id"),
            {"value": json.dumps(_embedding()), "id": event.id},
        )

        await db_session.run_sync(_EMBEDDING_MIGRATION.backfill_event_embeddings)
        await db_session.refresh(event)

        assert event.embedding_vector == _embedding()

    async def test_backfill_fails_with_actionable_invalid_embedding(
        self, db_session: AsyncSession
    ):
        await db_session.execute(text("ALTER TABLE events ADD COLUMN embedding JSON"))
        event = Event(
            title="Malformed embedding",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
        )
        db_session.add(event)
        await db_session.flush()
        await db_session.execute(
            text("UPDATE events SET embedding = '[0.1, 0.2]'::json WHERE id = :id"),
            {"id": event.id},
        )

        with pytest.raises(RuntimeError, match=f"{event.id}.*expected"):
            await db_session.run_sync(_EMBEDDING_MIGRATION.backfill_event_embeddings)

    async def test_contract_rejects_missing_or_mismatched_vector_before_drop(
        self, db_session: AsyncSession
    ):
        await db_session.execute(text("ALTER TABLE events ADD COLUMN embedding JSON"))
        event_id = uuid.uuid4().hex[:8]
        await db_session.execute(
            text(
                """INSERT INTO events (
                id, title, description, source, source_label, vibes,
                location_name, event_date, embedding)
                VALUES (
                :id, 'Contract guard', '', 'manual', 'campus_community', '[]'::json,
                'The Nest', now(), CAST(:value AS json))"""
            ),
            {"id": event_id, "value": json.dumps(_embedding())},
        )

        with pytest.raises(RuntimeError, match=f"{event_id}.*embedding_vector is NULL"):
            await db_session.run_sync(_CONTRACT_MIGRATION._check_legacy_embeddings)

        with pytest.raises(RuntimeError, match=f"{event_id}.*embedding_vector is NULL"):
            await db_session.run_sync(_run_contract_upgrade)
        assert (
            await db_session.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_name='events' AND column_name='embedding'"
                )
            )
            == 1
        )

        await db_session.execute(
            text(
                "UPDATE events SET embedding_vector = CAST(:value AS vector) "
                "WHERE id = :id"
            ),
            {"value": json.dumps(_embedding(0.0, 1.0)), "id": event_id},
        )
        with pytest.raises(RuntimeError, match=f"{event_id}.*does not match"):
            await db_session.run_sync(_CONTRACT_MIGRATION._check_legacy_embeddings)

    async def test_contract_allows_sql_and_json_null_and_roundtrips_vector(
        self, db_session: AsyncSession
    ):
        await db_session.execute(text("ALTER TABLE events ADD COLUMN embedding JSON"))
        event_id = uuid.uuid4().hex[:8]
        await db_session.execute(
            text(
                """INSERT INTO events (
                id, title, description, source, source_label, vibes,
                location_name, event_date, embedding, embedding_vector)
                VALUES (
                :id, 'Contract roundtrip', '', 'manual', 'campus_community', '[]'::json,
                'The Nest', now(), CAST(:value AS json), CAST(:vector AS vector))"""
            ),
            {
                "id": event_id,
                "value": json.dumps(_embedding(0.1, 0.2)),
                "vector": json.dumps(_embedding(0.1, 0.2)),
            },
        )
        null_id = uuid.uuid4().hex[:8]
        await db_session.execute(
            text(
                """INSERT INTO events (
                id, title, description, source, source_label, vibes,
                location_name, event_date, embedding)
                VALUES (
                :id, 'JSON null', '', 'manual', 'campus_community', '[]'::json,
                'The Nest', now(), 'null'::json)"""
            ),
            {"id": null_id},
        )
        sql_null_id = uuid.uuid4().hex[:8]
        await db_session.execute(
            text(
                """INSERT INTO events (
                id, title, description, source, source_label, vibes,
                location_name, event_date, embedding)
                VALUES (
                :id, 'SQL null', '', 'manual', 'campus_community', '[]'::json,
                'The Nest', now(), NULL)"""
            ),
            {"id": sql_null_id},
        )

        await db_session.run_sync(_CONTRACT_MIGRATION._check_legacy_embeddings)
        await db_session.run_sync(_run_contract_upgrade)
        assert (
            await db_session.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_name='events' AND column_name='embedding'"
                )
            )
            == 0
        )
        await db_session.run_sync(_run_contract_downgrade)
        restored = await db_session.scalar(
            text("SELECT embedding FROM events WHERE id = :id"), {"id": event_id}
        )
        assert restored == _embedding(0.1, 0.2)

    async def test_contract_upgrade_rejects_malformed_json_without_dropping_column(
        self, db_session: AsyncSession
    ):
        await db_session.execute(text("ALTER TABLE events ADD COLUMN embedding JSON"))
        event_id = uuid.uuid4().hex[:8]
        await db_session.execute(
            text(
                """INSERT INTO events (
                id, title, description, source, source_label, vibes,
                location_name, event_date, embedding)
                VALUES (
                :id, 'Malformed legacy embedding', '', 'manual',
                'campus_community', '[]'::json,
                'The Nest', now(), '{"not":"a vector"}'::json)"""
            ),
            {"id": event_id},
        )

        with pytest.raises(RuntimeError, match=f"{event_id}.*expected 1024"):
            await db_session.run_sync(_run_contract_upgrade)
        assert (
            await db_session.scalar(
                text(
                    "SELECT count(*) FROM information_schema.columns "
                    "WHERE table_name='events' AND column_name='embedding'"
                )
            )
            == 1
        )

    async def test_cosine_distance_retrieval_uses_vector_storage(
        self, db_session: AsyncSession
    ):
        nearest = Event(
            title="Nearest",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 1, 10, tzinfo=UTC),
            embedding_vector=_embedding(),
        )
        orthogonal = Event(
            title="Orthogonal",
            source="manual",
            location_name="The Nest",
            event_date=datetime(2026, 9, 2, 10, tzinfo=UTC),
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
