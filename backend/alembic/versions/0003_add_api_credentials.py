"""Add managed API credentials and credential audit history."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0003_add_api_credentials"
down_revision = "0002_add_event_embedding_vector"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column(
            "purpose",
            sa.String(length=50),
            server_default="candidate_ingestion",
            nullable=False,
        ),
        sa.Column("secret_hash", sa.String(length=255), nullable=False),
        sa.Column("created_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose = 'candidate_ingestion'",
            name="ck_api_credentials_candidate_ingestion_purpose",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_api_credentials_created_by_user_id",
        "api_credentials",
        ["created_by_user_id"],
    )
    op.create_index("ix_api_credentials_created_at", "api_credentials", ["created_at"])

    op.create_table(
        "api_credential_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("credential_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_type", sa.String(length=50), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=50), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "actor_type IN ('member', 'api_key')",
            name="ck_api_credential_audit_actor_type",
        ),
        sa.CheckConstraint(
            "action IN ('create', 'replace', 'revoke')",
            name="ck_api_credential_audit_action",
        ),
        sa.ForeignKeyConstraint(
            ["credential_id"], ["api_credentials.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_api_credential_audit_logs_credential_id",
        "api_credential_audit_logs",
        ["credential_id"],
    )
    op.create_index(
        "ix_api_credential_audit_logs_created_at",
        "api_credential_audit_logs",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_api_credential_audit_logs_created_at",
        table_name="api_credential_audit_logs",
    )
    op.drop_index(
        "ix_api_credential_audit_logs_credential_id",
        table_name="api_credential_audit_logs",
    )
    op.drop_table("api_credential_audit_logs")
    op.drop_index("ix_api_credentials_created_at", table_name="api_credentials")
    op.drop_index("ix_api_credentials_created_by_user_id", table_name="api_credentials")
    op.drop_table("api_credentials")
