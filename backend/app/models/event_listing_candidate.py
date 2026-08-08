import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class EventListingCandidate(Base):
    __tablename__ = "event_listing_candidates"
    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "external_source_id",
            name="uq_candidate_source_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    club_name: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    external_cta_label: Mapped[str | None] = mapped_column(String(80))
    vibes: Mapped[list[str]] = mapped_column(JSON, default=list)
    location_name: Mapped[str | None] = mapped_column(String(255))
    event_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source_type: Mapped[str] = mapped_column(String(50), index=True)
    external_source_id: Mapped[str] = mapped_column(String(512))
    source_excerpt: Mapped[str | None] = mapped_column(Text)
    image_reference: Mapped[str | None] = mapped_column(String(1024))
    extraction_confidence: Mapped[float] = mapped_column(Float)
    extraction_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    extraction_output: Mapped[dict] = mapped_column(JSON, default=dict)

    status: Mapped[str] = mapped_column(
        String(32), default="pending", server_default="pending", index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EventListingCandidateIngestionAudit(Base):
    __tablename__ = "event_listing_candidate_ingestion_audits"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("event_listing_candidates.id"),
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(50))
    external_source_id: Mapped[str] = mapped_column(String(512))
    outcome: Mapped[str] = mapped_column(String(32))
    credential_name: Mapped[str] = mapped_column(String(80))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
