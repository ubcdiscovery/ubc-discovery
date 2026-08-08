"""Create the deployed application schema and search index."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def _create_schema() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("firebase_uid", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("preferred_name", sa.String(length=255), nullable=False),
        sa.Column("major", sa.String(length=255), nullable=True),
        sa.Column("year_standing", sa.Integer(), nullable=True),
        sa.Column("faculty", sa.String(length=255), nullable=True),
        sa.Column("interests", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("profile_picture_key", sa.String(length=512), nullable=True),
        sa.Column("last_active_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_admin", sa.Boolean(), nullable=False),
        sa.Column("ubc_verified", sa.Boolean(), nullable=False),
        sa.Column("onboarding_completed", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_firebase_uid", "users", ["firebase_uid"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "events",
        sa.Column("id", sa.String(length=8), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("source_label", sa.String(length=50), nullable=False),
        sa.Column("source_url", sa.String(length=1024), nullable=True),
        sa.Column("external_cta_label", sa.String(length=80), nullable=True),
        sa.Column("club_name", sa.String(length=255), nullable=True),
        sa.Column("vibes", sa.JSON(), nullable=False),
        sa.Column("location_name", sa.String(length=255), nullable=False),
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("embedding", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "otp_codes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("used", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_otp_codes_email", "otp_codes", ["email"], unique=False)

    op.create_table(
        "event_ratings",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.String(length=8), nullable=False),
        sa.Column("stars", sa.Float(), nullable=False),
        sa.Column("strong_vibes", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "event_id", name="uq_user_event_rating"),
    )
    op.create_index("ix_event_ratings_user_id", "event_ratings", ["user_id"])
    op.create_index("ix_event_ratings_event_id", "event_ratings", ["event_id"])

    op.create_table(
        "saved_events",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_id", sa.String(length=8), nullable=False),
        sa.Column(
            "saved_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["event_id"], ["events.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "event_id"),
    )
    op.create_index("ix_saved_events_user_id", "saved_events", ["user_id"])
    op.create_index("ix_saved_events_event_id", "saved_events", ["event_id"])


def _ensure_search_index() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_events_search_trgm
        ON events USING gin (
            (coalesce(title, '') || ' ' || coalesce(club_name, '') ||
             ' ' || coalesce(location_name, ''))
            gin_trgm_ops
        )
        """
    )


def upgrade() -> None:
    _create_schema()
    _ensure_search_index()


def downgrade() -> None:
    raise RuntimeError(
        "The initial schema is an adoption baseline and cannot be downgraded safely; "
        "restore a database snapshot instead."
    )
