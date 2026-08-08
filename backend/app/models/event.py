from datetime import datetime

from nanoid import generate
from pgvector.sqlalchemy import Vector
from sqlalchemy import JSON, Boolean, DateTime, String, Text, false, func
from sqlalchemy.orm import Mapped, mapped_column

from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(
        String(8), primary_key=True, default=lambda: generate(size=8)
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(50))  # "instagram", "manual"
    source_label: Mapped[str] = mapped_column(String(50), default="campus_community")
    source_url: Mapped[str | None] = mapped_column(String(1024))
    external_cta_label: Mapped[str | None] = mapped_column(String(80))
    club_name: Mapped[str | None] = mapped_column(String(255))
    vibes: Mapped[list[str]] = mapped_column(JSON, default=list)

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
    archived_by: Mapped[str | None] = mapped_column(String(255))
    embedding: Mapped[list[float] | None] = mapped_column(
        JSON, nullable=True, default=None
    )
    embedding_vector: Mapped[list[float] | None] = mapped_column(
        Vector(EVENT_EMBEDDING_DIMENSIONS), nullable=True, default=None
    )
