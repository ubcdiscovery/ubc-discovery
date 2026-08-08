"""Add fixed-size pgvector storage and backfill legacy JSON embeddings."""

from __future__ import annotations

import json
import logging
import math

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector

from alembic import op
from app.constants import EVENT_EMBEDDING_DIMENSIONS

revision = "0002_add_event_embedding_vector"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None

logger = logging.getLogger(__name__)
VECTOR_INDEX_NAME = "ix_events_embedding_vector_hnsw"


def _validated_embedding(value: object, event_id: str) -> list[float]:
    if not isinstance(value, list):
        raise TypeError(f"{event_id}: embedding is not a JSON array")
    if len(value) != EVENT_EMBEDDING_DIMENSIONS:
        raise ValueError(
            f"{event_id}: expected {EVENT_EMBEDDING_DIMENSIONS} dimensions, "
            f"got {len(value)}"
        )

    result: list[float] = []
    for index, component in enumerate(value):
        if isinstance(component, bool) or not isinstance(component, (int, float)):
            raise TypeError(f"{event_id}: component {index} is not numeric")
        converted = float(component)
        if not math.isfinite(converted):
            raise ValueError(f"{event_id}: component {index} is not finite")
        result.append(converted)
    return result


def backfill_event_embeddings(connection: sa.Connection) -> int:
    """Validate and copy every legacy JSON embedding into the vector column."""
    rows = connection.execute(
        sa.text(
            "SELECT id, embedding FROM events WHERE embedding IS NOT NULL ORDER BY id"
        )
    ).mappings()

    valid: list[tuple[str, list[float]]] = []
    invalid: list[str] = []
    for row in rows:
        event_id = str(row["id"])
        try:
            valid.append((event_id, _validated_embedding(row["embedding"], event_id)))
        except (TypeError, ValueError) as exc:
            invalid.append(str(exc))

    if invalid:
        sample = "; ".join(invalid[:10])
        suffix = "" if len(invalid) <= 10 else f"; and {len(invalid) - 10} more"
        raise RuntimeError(
            "Event embedding backfill aborted: "
            f"{len(invalid)} malformed or incorrectly dimensioned embedding(s). "
            f"Fix the JSON values and rerun the migration. Samples: {sample}{suffix}"
        )

    for event_id, embedding in valid:
        connection.execute(
            sa.text(
                "UPDATE events SET embedding_vector = CAST(:embedding AS vector) "
                "WHERE id = :event_id"
            ),
            {"embedding": json.dumps(embedding), "event_id": event_id},
        )

    logger.info(
        "Backfilled %d valid Event Listing embedding(s) into embedding_vector",
        len(valid),
    )
    return len(valid)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column(
        "events",
        sa.Column(
            "embedding_vector",
            Vector(EVENT_EMBEDDING_DIMENSIONS),
            nullable=True,
        ),
    )
    backfill_event_embeddings(op.get_bind())
    op.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {VECTOR_INDEX_NAME}
        ON events USING hnsw (embedding_vector vector_cosine_ops)
        WHERE embedding_vector IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {VECTOR_INDEX_NAME}")
    op.drop_column("events", "embedding_vector")
