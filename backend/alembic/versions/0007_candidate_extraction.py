"""Add Candidate extraction draft fields and job queue."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_candidate_extraction"
down_revision = "0006_candidate_ingestion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "event_listing_candidates",
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("is_event", sa.Boolean(), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("title", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("location_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("event_end_date", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("club_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column(
            "vibes",
            sa.JSON(),
            server_default=sa.text("'[]'::json"),
            nullable=False,
        ),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("source_label", sa.String(length=50), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("extracted_original", sa.JSON(), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("extraction_model", sa.String(length=100), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column("extracted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_event_listing_candidate_source_label",
        "event_listing_candidates",
        "source_label IS NULL OR source_label IN "
        "('ubc_official', 'ams_club', 'campus_community')",
    )

    op.create_table(
        "candidate_extraction_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="pending",
            nullable=False,
        ),
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "attempts",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.CheckConstraint(
            "status IN ('pending', 'claimed', 'succeeded', 'failed')",
            name="ck_candidate_extraction_job_status",
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"],
            ["event_listing_candidates.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "candidate_id",
            name="uq_candidate_extraction_job_candidate_id",
        ),
    )
    op.create_index(
        "ix_candidate_extraction_jobs_status_available_at",
        "candidate_extraction_jobs",
        ["status", "available_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_candidate_extraction_jobs_status_available_at",
        table_name="candidate_extraction_jobs",
    )
    op.drop_table("candidate_extraction_jobs")
    op.drop_constraint(
        "ck_event_listing_candidate_source_label",
        "event_listing_candidates",
        type_="check",
    )
    op.drop_column("event_listing_candidates", "extracted_at")
    op.drop_column("event_listing_candidates", "extraction_model")
    op.drop_column("event_listing_candidates", "extracted_original")
    op.drop_column("event_listing_candidates", "source_label")
    op.drop_column("event_listing_candidates", "vibes")
    op.drop_column("event_listing_candidates", "club_name")
    op.drop_column("event_listing_candidates", "event_end_date")
    op.drop_column("event_listing_candidates", "event_date")
    op.drop_column("event_listing_candidates", "location_name")
    op.drop_column("event_listing_candidates", "title")
    op.drop_column("event_listing_candidates", "is_event")
    op.drop_column("event_listing_candidates", "posted_at")
