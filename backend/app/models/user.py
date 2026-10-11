import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "faculty_id IS NULL OR faculty_id IN ("
            "'applied-science', 'architecture-landscape-architecture', 'arts', "
            "'sauder', 'dentistry', 'education', 'forestry-environmental-stewardship', "
            "'kinesiology', 'land-food-systems', 'law', 'medicine', 'music', "
            "'nursing', "
            "'pharmaceutical-sciences', 'science', 'social-work', 'vantage-college', "
            "'vancouver-school-economics', 'other')",
            name="ck_users_faculty_id",
        ),
        CheckConstraint(
            "academic_level IS NULL OR academic_level IN ("
            "'year_1', 'year_2', 'year_3', 'year_4', 'year_5_plus', "
            "'graduate', 'postdoc', 'other')",
            name="ck_users_academic_level",
        ),
        CheckConstraint(
            "major IS NULL OR (major = btrim(major) AND major <> '')",
            name="ck_users_major_normalized",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    firebase_uid: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    preferred_name: Mapped[str] = mapped_column(String(255))

    major: Mapped[str | None] = mapped_column(String(255))
    academic_level: Mapped[str | None] = mapped_column(String(32))
    faculty_id: Mapped[str | None] = mapped_column(String(64))
    interests: Mapped[dict | None] = mapped_column(JSONB)
    bio: Mapped[str | None] = mapped_column(Text)
    profile_picture_key: Mapped[str | None] = mapped_column(String(512))

    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    ubc_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
