from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import mapped_column

from app.database import Base


class Connection(Base):
    __tablename__ = "connection"
    __table_args__ = (
        UniqueConstraint("user_1_id", "user_2_id"),
        CheckConstraint("user_1_id < user_2_id", name="ck_connection_ordered"),
    )

    connection_id = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user_1_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    user_2_id = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
