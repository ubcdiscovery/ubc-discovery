"""Add queue processing progress and scoped extraction credentials."""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_queue_extraction"
down_revision = "0011_drop_legacy_embedding"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "api_credentials",
        sa.Column(
            "scopes",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[\"candidates:ingest\"]'::jsonb"),
        ),
    )
    op.create_check_constraint(
        "ck_api_credential_scopes",
        "api_credentials",
        "jsonb_typeof(scopes) = 'array' AND jsonb_array_length(scopes) > 0 "
        'AND scopes <@ \'["candidates:ingest","candidates:extract"]\'::jsonb',
    )
    for name in (
        "capture_ready_at",
        "processing_dispatched_at",
        "processing_completed_at",
    ):
        op.add_column(
            "event_listing_candidates",
            sa.Column(name, sa.DateTime(timezone=True), nullable=True),
        )
    op.add_column(
        "event_listing_candidates",
        sa.Column("processing_error", sa.Text(), nullable=True),
    )
    op.add_column(
        "event_listing_candidates",
        sa.Column(
            "processing_generation", sa.Integer(), nullable=False, server_default="1"
        ),
    )

    # Historical extraction is already a finished review decision unless the
    # legacy queue explicitly records unfinished processing. Do not republish
    # old pending review drafts when queue-mode recovery is first enabled.
    op.execute("""
        UPDATE event_listing_candidates AS candidate
        SET processing_completed_at = candidate.extracted_at
        WHERE candidate.extracted_at IS NOT NULL AND (
            NOT EXISTS (SELECT 1 FROM candidate_extraction_jobs AS job
                        WHERE job.candidate_id = candidate.id)
            OR EXISTS (SELECT 1 FROM candidate_extraction_jobs AS job
                       WHERE job.candidate_id = candidate.id
                         AND job.status = 'succeeded')
        )
    """)
    op.execute("""
        UPDATE event_listing_candidates AS candidate
        SET processing_error = COALESCE(job.last_error,
                                        'Legacy extraction attempts exhausted')
        FROM candidate_extraction_jobs AS job
        WHERE job.candidate_id = candidate.id AND job.status = 'failed'
          AND candidate.processing_completed_at IS NULL
    """)


def downgrade():
    for name in (
        "capture_ready_at",
        "processing_dispatched_at",
        "processing_completed_at",
        "processing_error",
        "processing_generation",
    ):
        op.drop_column("event_listing_candidates", name)
    op.drop_constraint("ck_api_credential_scopes", "api_credentials", type_="check")
    op.drop_column("api_credentials", "scopes")
