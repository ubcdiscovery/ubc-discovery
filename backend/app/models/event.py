from datetime import datetime

from nanoid import generate
from sqlalchemy import JSON, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

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
    embedding: Mapped[list[float] | None] = mapped_column(
        JSON, nullable=True, default=None
    )
