from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import mapped_column

from app.database import Base


class ConnectionRequest(Base):
    __tablename__ = "connection_request"
    __table_args__ = (
        UniqueConstraint("sender_id", "receiver_id"),
    )

    request_id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    sent_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sender_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    receiver_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
