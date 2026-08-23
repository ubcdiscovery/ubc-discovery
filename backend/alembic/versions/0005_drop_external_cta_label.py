"""Drop unused Event Listing external CTA label."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0005_drop_external_cta_label"
down_revision = "0004_add_event_lifecycle_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("events", "external_cta_label")


def downgrade() -> None:
    op.add_column(
        "events",
        sa.Column("external_cta_label", sa.String(length=80), nullable=True),
    )
