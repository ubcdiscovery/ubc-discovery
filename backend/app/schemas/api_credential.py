import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.api_credential import ApiCredentialAuditAction
from app.models.audit_actor import AuditActorType

CredentialStatus = Literal["active", "expired", "revoked"]


class ApiCredentialCreateRequest(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("expires_at must include a timezone")
        return value

    @field_validator("label")
    @classmethod
    def strip_label(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("label must contain text")
        return value


class ApiCredentialResponse(BaseModel):
    id: uuid.UUID
    label: str
    created_by_user_id: uuid.UUID
    created_by_name: str
    created_by_email: str
    created_at: datetime
    expires_at: datetime | None
    revoked_at: datetime | None
    last_used_at: datetime | None
    status: CredentialStatus


class ApiCredentialCreateResponse(ApiCredentialResponse):
    raw_token: str


class ApiCredentialListResponse(BaseModel):
    credentials: list[ApiCredentialResponse]


class ApiCredentialAuditResponse(BaseModel):
    id: uuid.UUID
    credential_id: uuid.UUID
    actor_type: AuditActorType
    actor_id: uuid.UUID
    action: ApiCredentialAuditAction
    details: dict | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ApiCredentialAuditListResponse(BaseModel):
    entries: list[ApiCredentialAuditResponse]
