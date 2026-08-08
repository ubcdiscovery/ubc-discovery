"""Add Event Listing archival state and audit history."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_add_event_lifecycle_audit"
down_revision = "0002_add_event_embedding_vector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.add_column(
        "events",
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "events",
        sa.Column("archived_by", sa.String(length=255), nullable=True),
    )

    op.create_table(
        "event_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.String(length=8), nullable=False),
        sa.Column("actor_type", sa.String(length=50), nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column(
            "before", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_event_audit_logs_event_id", "event_audit_logs", ["event_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_event_audit_logs_event_id", table_name="event_audit_logs")
    op.drop_table("event_audit_logs")
    op.drop_column("events", "archived_by")
    op.drop_column("events", "archived_at")
    op.drop_column("events", "is_archived")
