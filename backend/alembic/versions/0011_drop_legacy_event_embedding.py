"""Drop the legacy JSON event embedding after validating vector parity."""

from __future__ import annotations

import math
import struct

import sqlalchemy as sa

from alembic import op

revision = "0011_drop_legacy_embedding"
down_revision = "0010_academic_context"
branch_labels = None
depends_on = None

VECTOR_DIMENSIONS = 1024


def _float32(value: float) -> float:
    return struct.unpack("!f", struct.pack("!f", value))[0]


def _check_legacy_embeddings(connection: sa.Connection) -> None:
    rows = connection.execute(
        sa.text(
            """
            SELECT id, embedding, embedding_vector::text AS embedding_vector
            FROM events
            WHERE embedding IS NOT NULL AND json_typeof(embedding) <> 'null'
            ORDER BY id
            """
        )
    ).mappings()
    errors: list[str] = []
    for row in rows:
        event_id = str(row["id"])
        try:
            value = row["embedding"]
            if not isinstance(value, list) or len(value) != VECTOR_DIMENSIONS:
                actual = len(value) if isinstance(value, list) else type(value).__name__
                raise ValueError(
                    f"expected {VECTOR_DIMENSIONS} numeric dimensions, got {actual}"
                )
            expected: list[float] = []
            for index, component in enumerate(value):
                if isinstance(component, bool) or not isinstance(
                    component, (int, float)
                ):
                    raise ValueError(f"component {index} is not numeric")
                number = float(component)
                if not math.isfinite(number):
                    raise ValueError(f"component {index} is not finite")
                expected.append(_float32(number))
            actual_text = row["embedding_vector"]
            if actual_text is None:
                raise ValueError("embedding_vector is NULL")
            actual = [
                _float32(float(component))
                for component in actual_text.strip("[]").split(",")
            ]
            if len(actual) != VECTOR_DIMENSIONS or actual != expected:
                raise ValueError(
                    "embedding_vector does not match the float32 legacy values"
                )
        except (TypeError, ValueError, OverflowError) as exc:
            errors.append(f"{event_id}: {exc}")

    if errors:
        sample = "; ".join(errors[:10])
        suffix = "" if len(errors) <= 10 else f"; and {len(errors) - 10} more"
        raise RuntimeError(
            "Cannot drop events.embedding: legacy values must be valid 1024-dimension "
            "finite vectors and match embedding_vector after float32 conversion. "
            "Repair/backfill the listed rows, then rerun the migration. "
            f"Invalid or mismatched rows: {sample}{suffix}"
        )


def upgrade() -> None:
    # Prevent writes during verification while allowing reads; DROP COLUMN
    # acquires ACCESS EXCLUSIVE only for the final schema change.
    op.execute("LOCK TABLE events IN SHARE ROW EXCLUSIVE MODE")
    _check_legacy_embeddings(op.get_bind())
    op.drop_column("events", "embedding")


def downgrade() -> None:
    op.add_column("events", sa.Column("embedding", sa.JSON(), nullable=True))
    op.execute(
        """
        UPDATE events
        SET embedding = embedding_vector::text::json
        WHERE embedding_vector IS NOT NULL
        """
    )
