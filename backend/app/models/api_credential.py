import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.audit_actor import AuditActorType


class ApiCredentialAuditAction(StrEnum):
    CREATE = "create"
    REPLACE = "replace"
    REVOKE = "revoke"


class ApiCredential(Base):
    __tablename__ = "api_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    label: Mapped[str] = mapped_column(String(80))
    secret_hash: Mapped[str] = mapped_column(String(255))
    created_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiCredentialAuditLog(Base):
    __tablename__ = "api_credential_audit_logs"
    __table_args__ = (
        CheckConstraint(
            "actor_type IN ('member', 'api_key')",
            name="ck_api_credential_audit_actor_type",
        ),
        CheckConstraint(
            "action IN ('create', 'replace', 'revoke')",
            name="ck_api_credential_audit_action",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    credential_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("api_credentials.id", ondelete="RESTRICT"),
        index=True,
    )
    actor_type: Mapped[AuditActorType] = mapped_column(String(50))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    action: Mapped[ApiCredentialAuditAction] = mapped_column(String(50))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
