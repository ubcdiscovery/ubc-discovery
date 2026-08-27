import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.audit_actor import AuditActorType


class EventAuditActorType(StrEnum):
    MEMBER = "member"
    API_KEY = "api_key"
    SYSTEM = "system"


@dataclass(frozen=True)
class EventAuditActor:
    actor_type: EventAuditActorType
    actor_id: uuid.UUID

    @classmethod
    def authenticated(
        cls, actor_type: AuditActorType, actor_id: uuid.UUID
    ) -> EventAuditActor:
        return cls(EventAuditActorType(actor_type), actor_id)

    @classmethod
    def system(cls, actor_id: uuid.UUID) -> EventAuditActor:
        return cls(EventAuditActorType.SYSTEM, actor_id)


class EventAuditAction(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    IMAGE_UPLOAD = "image_upload"
    ARCHIVE = "archive"
    RESTORE = "restore"


class EventAuditLog(Base):
    __tablename__ = "event_audit_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_type IN ('member', 'api_key', 'system')",
            name="ck_event_audit_actor_type",
        ),
        CheckConstraint(
            "action IN ('create', 'update', 'image_upload', 'archive', 'restore')",
            name="ck_event_audit_action",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    event_id: Mapped[str] = mapped_column(
        String(8),
        ForeignKey("events.id", ondelete="RESTRICT"),
        index=True,
    )
    actor_type: Mapped[EventAuditActorType] = mapped_column(String(50))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    action: Mapped[EventAuditAction] = mapped_column(String(50))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
