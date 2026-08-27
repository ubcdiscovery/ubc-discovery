"""Allow the system actor on Event Listing audit entries for auto-publication."""

from __future__ import annotations

from alembic import op

revision = "0009_auto_publication"
down_revision = "0008_candidate_review"
branch_labels = None
depends_on = None

ACTOR_TYPE_CHECK = "actor_type IN ('member', 'api_key', 'system')"


def upgrade() -> None:
    op.drop_constraint("ck_event_audit_actor_type", "event_audit_logs", type_="check")
    op.create_check_constraint(
        "ck_event_audit_actor_type", "event_audit_logs", ACTOR_TYPE_CHECK
    )


def downgrade() -> None:
    # Fails loudly if any system-actor audit rows still exist; deleting audit
    # history to satisfy a downgrade is not acceptable.
    op.drop_constraint("ck_event_audit_actor_type", "event_audit_logs", type_="check")
    op.create_check_constraint(
        "ck_event_audit_actor_type",
        "event_audit_logs",
        "actor_type IN ('member', 'api_key')",
    )
