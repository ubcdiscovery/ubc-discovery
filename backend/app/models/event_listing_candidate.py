import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    CheckConstraint,
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
from app.models.audit_actor import AuditActorType


class CandidateStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class CandidateIngestionOutcome(StrEnum):
    CREATED = "created"
    EXISTING = "existing"


class EventListingCandidate(Base):
    __tablename__ = "event_listing_candidates"
    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "external_source_id",
            name="uq_candidate_source_identity",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_event_listing_candidate_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    club_name: Mapped[str | None] = mapped_column(String(255))
    source_url: Mapped[str | None] = mapped_column(String(1024))
    vibes: Mapped[list[str]] = mapped_column(JSON, default=list)
    location_name: Mapped[str | None] = mapped_column(String(255))
    event_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    source_type: Mapped[str] = mapped_column(String(50), index=True)
    external_source_id: Mapped[str] = mapped_column(String(512))
    image_reference: Mapped[str | None] = mapped_column(String(1024))
    extraction_confidence: Mapped[float] = mapped_column(Float)
    extraction_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    extraction_output: Mapped[dict] = mapped_column(JSON, default=dict)

    status: Mapped[CandidateStatus] = mapped_column(
        String(32),
        default=CandidateStatus.PENDING,
        server_default=CandidateStatus.PENDING.value,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EventListingCandidateIngestionAudit(Base):
    __tablename__ = "event_listing_candidate_ingestion_audits"
    __table_args__ = (
        CheckConstraint(
            "actor_type IN ('member', 'api_key')",
            name="ck_candidate_ingestion_audit_actor_type",
        ),
        CheckConstraint(
            "outcome IN ('created', 'existing')",
            name="ck_candidate_ingestion_audit_outcome",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("event_listing_candidates.id", ondelete="RESTRICT"),
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(50))
    external_source_id: Mapped[str] = mapped_column(String(512))
    outcome: Mapped[CandidateIngestionOutcome] = mapped_column(String(32))
    actor_type: Mapped[AuditActorType] = mapped_column(String(50))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    credential_label: Mapped[str] = mapped_column(String(80))
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
