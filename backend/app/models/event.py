import uuid
from datetime import datetime
from enum import StrEnum

from nanoid import generate
from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.database import Base


class EventSourceLabel(StrEnum):
    UBC_OFFICIAL = "ubc_official"
    AMS_CLUB = "ams_club"
    CAMPUS_COMMUNITY = "campus_community"


class EventVibe(StrEnum):
    SOCIAL = "social"
    CAREER = "career"
    ACADEMIC = "academic"
    ARTS = "arts"
    CULTURE = "culture"
    OUTDOORS = "outdoors"
    SPORTS = "sports"
    FOOD = "food"
    WELLNESS = "wellness"
    VOLUNTEERING = "volunteering"


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint(
            "source_label IN ('ubc_official', 'ams_club', 'campus_community')",
            name="ck_event_source_label",
        ),
    )

    id: Mapped[str] = mapped_column(
        String(8), primary_key=True, default=lambda: generate(size=8)
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(50))  # "instagram", "manual"
    source_label: Mapped[EventSourceLabel] = mapped_column(
        String(50), default=EventSourceLabel.CAMPUS_COMMUNITY
    )
    source_url: Mapped[str | None] = mapped_column(String(1024))
    club_name: Mapped[str | None] = mapped_column(String(255))
    vibes: Mapped[list[EventVibe]] = mapped_column(JSON, default=list)

    location_name: Mapped[str] = mapped_column(String(255), nullable=False)

    event_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    embedding: Mapped[list[float] | None] = mapped_column(
        JSON, nullable=True, default=None
    )
    embedding_vector: Mapped[list[float] | None] = mapped_column(
        Vector(EVENT_EMBEDDING_DIMENSIONS), nullable=True, default=None
    )
