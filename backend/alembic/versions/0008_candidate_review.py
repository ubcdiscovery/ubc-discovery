"""Move Candidate identifiers into the shared eight-character id space."""

# SQL statements are intentionally kept legible; their lengths are not code style.
# ruff: noqa: E501

from __future__ import annotations

import uuid

import sqlalchemy as sa
from nanoid import generate

from alembic import op

revision = "0008_candidate_review"
down_revision = "0007_candidate_extraction"
branch_labels = None
depends_on = None

EVENT_SOURCE_LABEL_CHECK = (
    "source_label IN ('ubc_official', 'ams_club', 'campus_community')"
)


def _upgrade_ids(connection: sa.Connection) -> None:
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits DROP CONSTRAINT IF EXISTS event_listing_candidate_ingestion_audits_candidate_id_fkey"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs DROP CONSTRAINT IF EXISTS candidate_extraction_jobs_candidate_id_fkey"
        )
    )
    connection.execute(
        sa.text("""
        CREATE TEMP TABLE candidate_id_migration_map (
            legacy_id UUID PRIMARY KEY,
            candidate_id VARCHAR(8) NOT NULL UNIQUE
        )
    """)
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates ADD COLUMN _legacy_id UUID")
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates ADD COLUMN _new_id VARCHAR(8)")
    )
    connection.execute(sa.text("UPDATE event_listing_candidates SET _legacy_id = id"))
    used = {str(row[0]) for row in connection.execute(sa.text("SELECT id FROM events"))}
    used.update(
        str(row[0])
        for row in connection.execute(
            sa.text("SELECT id FROM event_listing_candidates")
        )
    )
    rows = list(
        connection.execute(
            sa.text("SELECT id FROM event_listing_candidates ORDER BY id")
        )
    )
    for (legacy_id,) in rows:
        while True:
            candidate_id = generate(size=8)
            if candidate_id not in used:
                break
        used.add(candidate_id)
        connection.execute(
            sa.text(
                "UPDATE event_listing_candidates SET _new_id = :new_id WHERE _legacy_id = :legacy_id"
            ),
            {"new_id": candidate_id, "legacy_id": legacy_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO candidate_id_migration_map (legacy_id, candidate_id) VALUES (:legacy_id, :candidate_id)"
            ),
            {"legacy_id": legacy_id, "candidate_id": candidate_id},
        )

    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ADD COLUMN _candidate_id_new VARCHAR(8)"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD COLUMN _candidate_id_new VARCHAR(8)"
        )
    )
    connection.execute(
        sa.text("""
        UPDATE event_listing_candidate_ingestion_audits a
        SET _candidate_id_new = m.candidate_id
        FROM candidate_id_migration_map m
        WHERE a.candidate_id = m.legacy_id
    """)
    )
    connection.execute(
        sa.text("""
        UPDATE candidate_extraction_jobs j
        SET _candidate_id_new = m.candidate_id
        FROM candidate_id_migration_map m
        WHERE j.candidate_id = m.legacy_id
    """)
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits DROP COLUMN candidate_id"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits RENAME COLUMN _candidate_id_new TO candidate_id"
        )
    )
    connection.execute(
        sa.text("ALTER TABLE candidate_extraction_jobs DROP COLUMN candidate_id")
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs RENAME COLUMN _candidate_id_new TO candidate_id"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidates DROP CONSTRAINT event_listing_candidates_pkey"
        )
    )
    connection.execute(sa.text("ALTER TABLE event_listing_candidates DROP COLUMN id"))
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates RENAME COLUMN _new_id TO id")
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates ALTER COLUMN id SET NOT NULL")
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidates ADD CONSTRAINT event_listing_candidates_pkey PRIMARY KEY (id)"
        )
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates DROP COLUMN _legacy_id")
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ADD CONSTRAINT event_listing_candidate_ingestion_audits_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES event_listing_candidates(id) ON DELETE RESTRICT"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD CONSTRAINT candidate_extraction_jobs_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES event_listing_candidates(id) ON DELETE RESTRICT"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ALTER COLUMN candidate_id SET NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "CREATE INDEX ix_event_listing_candidate_ingestion_audits_candidate_id ON event_listing_candidate_ingestion_audits (candidate_id)"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ALTER COLUMN candidate_id SET NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD CONSTRAINT uq_candidate_extraction_job_candidate_id UNIQUE (candidate_id)"
        )
    )
    connection.execute(sa.text("DROP TABLE candidate_id_migration_map"))


def upgrade() -> None:
    _upgrade_ids(op.get_bind())
    op.create_check_constraint(
        "ck_event_source_label", "events", sa.text(EVENT_SOURCE_LABEL_CHECK)
    )


def downgrade() -> None:
    connection = op.get_bind()
    op.drop_constraint("ck_event_source_label", "events", type_="check")
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits DROP CONSTRAINT IF EXISTS event_listing_candidate_ingestion_audits_candidate_id_fkey"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs DROP CONSTRAINT IF EXISTS candidate_extraction_jobs_candidate_id_fkey"
        )
    )
    connection.execute(
        sa.text(
            "CREATE TEMP TABLE candidate_id_migration_map (legacy_id UUID PRIMARY KEY, candidate_id VARCHAR(8) NOT NULL UNIQUE)"
        )
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates ADD COLUMN _legacy_uuid UUID")
    )
    current_rows = list(
        connection.execute(
            sa.text("SELECT id FROM event_listing_candidates ORDER BY id")
        )
    )
    for (candidate_id,) in current_rows:
        legacy_id = uuid.uuid4()
        connection.execute(
            sa.text(
                "UPDATE event_listing_candidates SET _legacy_uuid = :legacy_id WHERE id = :candidate_id"
            ),
            {"legacy_id": legacy_id, "candidate_id": candidate_id},
        )
        connection.execute(
            sa.text(
                "INSERT INTO candidate_id_migration_map (legacy_id, candidate_id) VALUES (:legacy_id, :candidate_id)"
            ),
            {"legacy_id": legacy_id, "candidate_id": candidate_id},
        )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ADD COLUMN _candidate_id_uuid UUID"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD COLUMN _candidate_id_uuid UUID"
        )
    )
    connection.execute(
        sa.text("""
        UPDATE event_listing_candidate_ingestion_audits a SET _candidate_id_uuid = m.legacy_id
        FROM candidate_id_migration_map m WHERE a.candidate_id = m.candidate_id
    """)
    )
    connection.execute(
        sa.text("""
        UPDATE candidate_extraction_jobs j SET _candidate_id_uuid = m.legacy_id
        FROM candidate_id_migration_map m WHERE j.candidate_id = m.candidate_id
    """)
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits DROP COLUMN candidate_id"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits RENAME COLUMN _candidate_id_uuid TO candidate_id"
        )
    )
    connection.execute(
        sa.text("ALTER TABLE candidate_extraction_jobs DROP COLUMN candidate_id")
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs RENAME COLUMN _candidate_id_uuid TO candidate_id"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidates DROP CONSTRAINT event_listing_candidates_pkey"
        )
    )
    connection.execute(sa.text("ALTER TABLE event_listing_candidates DROP COLUMN id"))
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates RENAME COLUMN _legacy_uuid TO id")
    )
    connection.execute(
        sa.text("ALTER TABLE event_listing_candidates ALTER COLUMN id SET NOT NULL")
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidates ADD CONSTRAINT event_listing_candidates_pkey PRIMARY KEY (id)"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ADD CONSTRAINT event_listing_candidate_ingestion_audits_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES event_listing_candidates(id) ON DELETE RESTRICT"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD CONSTRAINT candidate_extraction_jobs_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES event_listing_candidates(id) ON DELETE RESTRICT"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE event_listing_candidate_ingestion_audits ALTER COLUMN candidate_id SET NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "CREATE INDEX ix_event_listing_candidate_ingestion_audits_candidate_id ON event_listing_candidate_ingestion_audits (candidate_id)"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ALTER COLUMN candidate_id SET NOT NULL"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE candidate_extraction_jobs ADD CONSTRAINT uq_candidate_extraction_job_candidate_id UNIQUE (candidate_id)"
        )
    )
    connection.execute(sa.text("DROP TABLE candidate_id_migration_map"))
