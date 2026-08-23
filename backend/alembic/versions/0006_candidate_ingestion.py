"""Store extracted Event Listing Candidates and ingestion receipts."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0006_candidate_ingestion"
down_revision = "0005_drop_external_cta_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_listing_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("club_name", sa.String(length=255), nullable=True),
        sa.Column("source_url", sa.String(length=1024), nullable=True),
        sa.Column("vibes", sa.JSON(), nullable=False),
        sa.Column("location_name", sa.String(length=255), nullable=True),
        sa.Column("event_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("event_end_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("external_source_id", sa.String(length=512), nullable=False),
        sa.Column("image_reference", sa.String(length=1024), nullable=True),
        sa.Column("extraction_confidence", sa.Float(), nullable=False),
        sa.Column("extraction_metadata", sa.JSON(), nullable=False),
        sa.Column("extraction_output", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=32),
            server_default="pending",
            nullable=False,
        ),
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
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_event_listing_candidate_status",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_type",
            "external_source_id",
            name="uq_candidate_source_identity",
        ),
    )
    op.create_index(
        "ix_event_listing_candidates_source_type",
        "event_listing_candidates",
        ["source_type"],
    )
    op.create_index(
        "ix_event_listing_candidates_status",
        "event_listing_candidates",
        ["status"],
    )
    op.create_index(
        "ix_event_listing_candidates_created_at",
        "event_listing_candidates",
        ["created_at"],
    )

    op.create_table(
        "event_listing_candidate_ingestion_audits",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("candidate_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("external_source_id", sa.String(length=512), nullable=False),
        sa.Column("outcome", sa.String(length=32), nullable=False),
        sa.Column("actor_type", sa.String(length=50), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("credential_label", sa.String(length=80), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type IN ('member', 'api_key')",
            name="ck_candidate_ingestion_audit_actor_type",
        ),
        sa.CheckConstraint(
            "outcome IN ('created', 'existing')",
            name="ck_candidate_ingestion_audit_outcome",
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"],
            ["event_listing_candidates.id"],
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_event_listing_candidate_ingestion_audits_candidate_id",
        "event_listing_candidate_ingestion_audits",
        ["candidate_id"],
    )
    op.create_index(
        "ix_event_listing_candidate_ingestion_audits_received_at",
        "event_listing_candidate_ingestion_audits",
        ["received_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_event_listing_candidate_ingestion_audits_received_at",
        table_name="event_listing_candidate_ingestion_audits",
    )
    op.drop_index(
        "ix_event_listing_candidate_ingestion_audits_candidate_id",
        table_name="event_listing_candidate_ingestion_audits",
    )
    op.drop_table("event_listing_candidate_ingestion_audits")
    op.drop_index(
        "ix_event_listing_candidates_created_at",
        table_name="event_listing_candidates",
    )
    op.drop_index(
        "ix_event_listing_candidates_status",
        table_name="event_listing_candidates",
    )
    op.drop_index(
        "ix_event_listing_candidates_source_type",
        table_name="event_listing_candidates",
    )
    op.drop_table("event_listing_candidates")
