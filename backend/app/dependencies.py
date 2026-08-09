import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.api_credential import ApiCredential, ApiCredentialPurpose
from app.models.audit_actor import AuditActorType
from app.models.user import User
from app.services import api_credentials, firebase_auth


class FirebaseIdentity:
    def __init__(self, uid: str, email: str, name: str):
        self.uid = uid
        self.email = email
        self.name = name


@dataclass(frozen=True)
class CandidateIngestionCredential:
    actor_type: AuditActorType
    actor_id: uuid.UUID
    name: str
    credential_id: uuid.UUID | None = None


async def require_candidate_ingester(
    authorization: str | None = Header(
        None, description="Api-Key ubc_live_<credential-id>.<random-secret>"
    ),
    db: AsyncSession = Depends(get_db),
) -> CandidateIngestionCredential:
    if not authorization:
        raise HTTPException(
            status_code=401, detail="Candidate ingestion credential required"
        )
    if not authorization.startswith("Api-Key "):
        raise HTTPException(status_code=403, detail="Invalid API credential")

    token = authorization[len("Api-Key ") :]
    parsed = api_credentials.parse_token(token)
    if parsed is None:
        raise HTTPException(status_code=403, detail="Invalid API credential")

    credential_id, secret = parsed
    credential = await db.get(ApiCredential, credential_id)
    now = datetime.now(UTC)
    if (
        credential is None
        or credential.purpose != ApiCredentialPurpose.CANDIDATE_INGESTION
        or credential.revoked_at is not None
        or (credential.expires_at is not None and credential.expires_at <= now)
        or not api_credentials.verify_secret(secret, credential.secret_hash)
    ):
        raise HTTPException(status_code=403, detail="Invalid API credential")

    credential.last_used_at = now
    return CandidateIngestionCredential(
        actor_type=AuditActorType.API_KEY,
        actor_id=credential.id,
        name=credential.label,
        credential_id=credential.id,
    )


@dataclass(frozen=True)
class AdminActor:
    actor_type: AuditActorType
    actor_id: uuid.UUID


async def get_firebase_identity(
    authorization: str | None = Header(None, description="Bearer <id_token>"),
) -> FirebaseIdentity:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=403, detail="Firebase administrator authentication required"
        )

    token = authorization[7:]
    decoded = firebase_auth.verify_id_token(token)

    if not decoded.get("email_verified"):
        raise HTTPException(
            status_code=403,
            detail="Email not verified. Please check your inbox and verify your email.",
        )

    return FirebaseIdentity(
        uid=decoded["uid"],
        email=decoded["email"],
        name=decoded.get("name", ""),
    )


async def get_current_user(
    identity: FirebaseIdentity = Depends(get_firebase_identity),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(select(User).where(User.firebase_uid == identity.uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=404, detail="User profile not found. Complete onboarding first."
        )
    return user


async def require_admin(
    identity: FirebaseIdentity = Depends(get_firebase_identity),
    db: AsyncSession = Depends(get_db),
) -> AdminActor:
    result = await db.execute(select(User).where(User.firebase_uid == identity.uid))
    user = result.scalar_one_or_none()
    if user and user.is_admin:
        return AdminActor(actor_type=AuditActorType.MEMBER, actor_id=user.id)
    raise HTTPException(status_code=403, detail="Admin access required")


async def get_admin_user(
    actor: AdminActor = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    if actor.actor_type != AuditActorType.MEMBER:
        raise HTTPException(status_code=403, detail="Administrator Member required")
    user = await db.get(User, actor.actor_id)
    if user is None or not user.is_admin:
        raise HTTPException(status_code=403, detail="Administrator Member required")
    return user
