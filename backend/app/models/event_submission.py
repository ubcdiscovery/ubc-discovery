import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

SUBMISSION_PENDING = "pending"
SUBMISSION_APPROVED = "approved"
SUBMISSION_REJECTED = "rejected"


class EventSubmission(Base):
    """An organizer-supplied event awaiting review.

    Submissions never appear on Discover. Approving one creates a separate
    Event row and records its id here.
    """

    __tablename__ = "event_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    submitted_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str] = mapped_column(Text, default="")
    club_name: Mapped[str] = mapped_column(String(255))
    source_label: Mapped[str] = mapped_column(String(50), default="campus_community")
    source_url: Mapped[str | None] = mapped_column(String(1024))
    external_cta_label: Mapped[str | None] = mapped_column(String(80))
    vibes: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Set once the organizer's poster upload is issued; carried over to the
    # published Event on approval so the same S3 object is reused.
    event_picture_key: Mapped[str | None] = mapped_column(String(512))

    location_name: Mapped[str] = mapped_column(String(255), nullable=False)

    event_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    event_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    status: Mapped[str] = mapped_column(
        String(20), default=SUBMISSION_PENDING, index=True
    )
    review_note: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_event_id: Mapped[str | None] = mapped_column(
        String(8), ForeignKey("events.id", ondelete="SET NULL")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
