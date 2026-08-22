import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import AdminActor, get_admin_user, require_admin
from app.models.api_credential import (
    ApiCredential,
    ApiCredentialAuditAction,
    ApiCredentialAuditLog,
)
from app.models.user import User
from app.schemas.api_credential import (
    ApiCredentialAuditListResponse,
    ApiCredentialAuditResponse,
    ApiCredentialCreateRequest,
    ApiCredentialCreateResponse,
    ApiCredentialListResponse,
    ApiCredentialResponse,
    CredentialStatus,
)
from app.services import api_credentials

router = APIRouter(prefix="/api-keys", tags=["Admin API Credentials"])


def _credential_status(credential: ApiCredential, now: datetime) -> CredentialStatus:
    if credential.revoked_at is not None:
        return "revoked"
    if credential.expires_at is not None and credential.expires_at <= now:
        return "expired"
    return "active"


def _credential_response(
    credential: ApiCredential, creator: User, now: datetime
) -> ApiCredentialResponse:
    return ApiCredentialResponse(
        id=credential.id,
        label=credential.label,
        created_by_user_id=credential.created_by_user_id,
        created_by_name=creator.preferred_name,
        created_by_email=creator.email,
        created_at=credential.created_at,
        expires_at=credential.expires_at,
        revoked_at=credential.revoked_at,
        last_used_at=credential.last_used_at,
        status=_credential_status(credential, now),
    )


def _add_audit(
    db: AsyncSession,
    credential: ApiCredential,
    actor: AdminActor,
    action: ApiCredentialAuditAction,
    details: dict | None = None,
) -> None:
    db.add(
        ApiCredentialAuditLog(
            credential_id=credential.id,
            actor_type=actor.actor_type,
            actor_id=actor.actor_id,
            action=action.value,
            details=details,
            created_at=datetime.now(UTC),
        )
    )


async def _get_credential(
    credential_id: uuid.UUID, db: AsyncSession
) -> tuple[ApiCredential, User]:
    result = await db.execute(
        select(ApiCredential, User)
        .join(User, User.id == ApiCredential.created_by_user_id)
        .where(ApiCredential.id == credential_id)
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="API credential not found")
    return row[0], row[1]


@router.get("", response_model=ApiCredentialListResponse)
async def list_api_credentials(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    result = await db.execute(
        select(ApiCredential, User)
        .join(User, User.id == ApiCredential.created_by_user_id)
        .order_by(ApiCredential.created_at.desc(), ApiCredential.id.desc())
    )
    now = datetime.now(UTC)
    return ApiCredentialListResponse(
        credentials=[
            _credential_response(credential, creator, now)
            for credential, creator in result.all()
        ]
    )


@router.post(
    "", response_model=ApiCredentialCreateResponse, status_code=status.HTTP_201_CREATED
)
async def create_api_credential(
    body: ApiCredentialCreateRequest,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_admin_user),
    actor: AdminActor = Depends(require_admin),
):
    now = datetime.now(UTC)
    if body.expires_at is not None and body.expires_at <= now:
        raise HTTPException(status_code=422, detail="expires_at must be in the future")

    secret = api_credentials.generate_secret()
    credential = ApiCredential(
        label=body.label,
        secret_hash=api_credentials.hash_secret(secret),
        created_by_user_id=admin.id,
        expires_at=body.expires_at,
    )
    db.add(credential)
    await db.flush()
    _add_audit(
        db,
        credential,
        actor,
        ApiCredentialAuditAction.CREATE,
        {"label": credential.label},
    )
    await db.commit()
    await db.refresh(credential)
    return ApiCredentialCreateResponse(
        **_credential_response(credential, admin, now).model_dump(),
        raw_token=api_credentials.format_token(credential.id, secret),
    )


@router.post("/{credential_id}/revoke", response_model=ApiCredentialResponse)
async def revoke_api_credential(
    credential_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
    actor: AdminActor = Depends(require_admin),
):
    credential, creator = await _get_credential(credential_id, db)
    if credential.revoked_at is None:
        credential.revoked_at = datetime.now(UTC)
        _add_audit(db, credential, actor, ApiCredentialAuditAction.REVOKE)
        await db.commit()
        await db.refresh(credential)
    return _credential_response(credential, creator, datetime.now(UTC))


@router.get("/{credential_id}/audit", response_model=ApiCredentialAuditListResponse)
async def list_api_credential_audit(
    credential_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    await _get_credential(credential_id, db)
    result = await db.execute(
        select(ApiCredentialAuditLog)
        .where(ApiCredentialAuditLog.credential_id == credential_id)
        .order_by(
            ApiCredentialAuditLog.created_at.asc(), ApiCredentialAuditLog.id.asc()
        )
    )
    return ApiCredentialAuditListResponse(
        entries=[
            ApiCredentialAuditResponse.model_validate(entry)
            for entry in result.scalars()
        ]
    )
