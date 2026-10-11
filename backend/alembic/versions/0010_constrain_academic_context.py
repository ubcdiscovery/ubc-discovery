"""Constrain member academic context to stable identifiers."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010_academic_context"
down_revision = "0009_auto_publication"
branch_labels = None
depends_on = None

FACULTY_ID_CHECK = """faculty_id IN (
    'applied-science', 'architecture-landscape-architecture', 'arts',
    'sauder', 'dentistry', 'education', 'forestry-environmental-stewardship',
    'kinesiology', 'land-food-systems', 'law', 'medicine', 'music', 'nursing',
    'pharmaceutical-sciences', 'science', 'social-work', 'vantage-college',
    'vancouver-school-economics', 'other'
)"""

ACADEMIC_LEVEL_CHECK = """academic_level IN (
    'year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus',
    'graduate', 'postdoc', 'other'
)"""


def upgrade() -> None:
    op.add_column("users", sa.Column("faculty_id", sa.String(length=64), nullable=True))
    op.add_column(
        "users", sa.Column("academic_level", sa.String(length=32), nullable=True)
    )

    op.execute(
        """
        UPDATE users
        SET faculty_id = CASE faculty
            WHEN 'Applied Science (Engineering)' THEN 'applied-science'
            WHEN 'Architecture' THEN 'architecture-landscape-architecture'
            WHEN 'Arts' THEN 'arts'
            WHEN 'Sauder · Business' THEN 'sauder'
            WHEN 'Dentistry' THEN 'dentistry'
            WHEN 'Education' THEN 'education'
            WHEN 'Forestry' THEN 'forestry-environmental-stewardship'
            WHEN 'Kinesiology' THEN 'kinesiology'
            WHEN 'Land & Food Systems' THEN 'land-food-systems'
            WHEN 'Peter A. Allard School of Law' THEN 'law'
            WHEN 'Medicine' THEN 'medicine'
            WHEN 'Music' THEN 'music'
            WHEN 'Nursing' THEN 'nursing'
            WHEN 'Pharmaceutical Sciences' THEN 'pharmaceutical-sciences'
            WHEN 'Science' THEN 'science'
            WHEN 'Social Work' THEN 'social-work'
            WHEN 'UBC Vantage College' THEN 'vantage-college'
            WHEN 'Vancouver School of Economics' THEN 'vancouver-school-economics'
            WHEN 'Other' THEN 'other'
        END
        WHERE faculty IS NOT NULL
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM users WHERE faculty IS NOT NULL AND faculty_id IS NULL
            ) THEN
                RAISE EXCEPTION 'Cannot migrate unknown users.faculty values';
            END IF;
        END $$
        """
    )

    op.execute(
        """
        UPDATE users
        SET academic_level = CASE
            WHEN year_standing = 1 THEN 'year_1'
            WHEN year_standing = 2 THEN 'year_2'
            WHEN year_standing = 3 THEN 'year_3'
            WHEN year_standing = 4 THEN 'year_4'
            WHEN year_standing >= 5 THEN 'year_5_plus'
        END
        WHERE year_standing IS NOT NULL
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM users
                WHERE year_standing IS NOT NULL AND academic_level IS NULL
            ) THEN
                RAISE EXCEPTION 'Cannot migrate invalid users.year_standing values';
            END IF;
        END $$
        """
    )

    op.create_check_constraint("ck_users_faculty_id", "users", FACULTY_ID_CHECK)
    op.create_check_constraint("ck_users_academic_level", "users", ACADEMIC_LEVEL_CHECK)
    op.create_check_constraint(
        "ck_users_major_normalized",
        "users",
        "major IS NULL OR (major = btrim(major) AND major <> '')",
    )
    op.drop_column("users", "faculty")
    op.drop_column("users", "year_standing")


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM users
                WHERE academic_level IN ('graduate', 'postdoc', 'other')
            ) THEN
                RAISE EXCEPTION 'Cannot downgrade non-numeric academic levels';
            END IF;
        END $$
        """
    )

    op.add_column("users", sa.Column("faculty", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("year_standing", sa.Integer(), nullable=True))
    op.execute(
        """
        UPDATE users
        SET faculty = CASE faculty_id
            WHEN 'applied-science' THEN 'Applied Science (Engineering)'
            WHEN 'architecture-landscape-architecture' THEN 'Architecture'
            WHEN 'arts' THEN 'Arts'
            WHEN 'sauder' THEN 'Sauder · Business'
            WHEN 'dentistry' THEN 'Dentistry'
            WHEN 'education' THEN 'Education'
            WHEN 'forestry-environmental-stewardship' THEN 'Forestry'
            WHEN 'kinesiology' THEN 'Kinesiology'
            WHEN 'land-food-systems' THEN 'Land & Food Systems'
            WHEN 'law' THEN 'Peter A. Allard School of Law'
            WHEN 'medicine' THEN 'Medicine'
            WHEN 'music' THEN 'Music'
            WHEN 'nursing' THEN 'Nursing'
            WHEN 'pharmaceutical-sciences' THEN 'Pharmaceutical Sciences'
            WHEN 'science' THEN 'Science'
            WHEN 'social-work' THEN 'Social Work'
            WHEN 'vantage-college' THEN 'UBC Vantage College'
            WHEN 'vancouver-school-economics' THEN 'Vancouver School of Economics'
            WHEN 'other' THEN 'Other'
        END,
        year_standing = CASE academic_level
            WHEN 'year_1' THEN 1
            WHEN 'year_2' THEN 2
            WHEN 'year_3' THEN 3
            WHEN 'year_4' THEN 4
            WHEN 'year_5_plus' THEN 5
        END
        """
    )
    op.drop_constraint("ck_users_major_normalized", "users", type_="check")
    op.drop_constraint("ck_users_academic_level", "users", type_="check")
    op.drop_constraint("ck_users_faculty_id", "users", type_="check")
    op.drop_column("users", "academic_level")
    op.drop_column("users", "faculty_id")
