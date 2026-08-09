import logging

from fastapi import Depends, HTTPException, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.services import firebase_auth

logger = logging.getLogger(__name__)

DEV_TOKEN_PREFIX = "mock-token"


class FirebaseIdentity:
    def __init__(self, uid: str, email: str, name: str):
        self.uid = uid
        self.email = email
        self.name = name


def _dev_identity(token: str) -> FirebaseIdentity | None:
    """Accept the web app's test-mode token when local dev auth is switched on.

    Refuses to engage unless Firebase is genuinely unconfigured, so an
    AUTH_DEV_BYPASS left on in a real environment still cannot forge anyone.
    """
    if not settings.auth_dev_bypass or settings.firebase_credentials_json:
        return None

    parts = token.split(":", 2)
    if len(parts) != 3 or parts[0] != DEV_TOKEN_PREFIX:
        return None

    uid, email = parts[1].strip(), parts[2].strip()
    if not uid or not email:
        return None

    logger.warning(
        "AUTH_DEV_BYPASS accepted a development token for %s. Never enable "
        "this outside local development",
        email,
    )
    return FirebaseIdentity(uid=uid, email=email, name="")


async def get_firebase_identity(
    authorization: str | None = Header(None, description="Bearer <id_token>"),
) -> FirebaseIdentity:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header missing")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization[7:]

    dev_identity = _dev_identity(token)
    if dev_identity:
        return dev_identity

    decoded = firebase_auth.verify_id_token(token)

    if not decoded.get("email_verified"):
        raise HTTPException(status_code=403, detail="Email not verified. Please check your inbox and verify your email.")

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
        raise HTTPException(status_code=404, detail="User profile not found. Complete onboarding first.")
    return user


async def require_admin(
    authorization: str = Header(..., description="Bearer <id_token> or Api-Key <key>"),
    db: AsyncSession = Depends(get_db),
) -> None:
    if authorization.startswith("Api-Key "):
        key = authorization[8:]
        if not settings.admin_api_key or key != settings.admin_api_key:
            raise HTTPException(status_code=403, detail="Invalid API key")
        return

    if authorization.startswith("Bearer "):
        token = authorization[7:]
        # The dev bypass only says who you are; is_admin on the row still decides.
        dev_identity = _dev_identity(token)
        uid = (
            dev_identity.uid
            if dev_identity
            else firebase_auth.verify_id_token(token)["uid"]
        )
        result = await db.execute(select(User).where(User.firebase_uid == uid))
        user = result.scalar_one_or_none()
        if user and user.is_admin:
            return
        raise HTTPException(status_code=403, detail="Admin access required")

    raise HTTPException(status_code=401, detail="Invalid authorization header")
