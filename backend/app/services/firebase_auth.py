import logging

from fastapi import HTTPException
from firebase_admin import auth

logger = logging.getLogger(__name__)


def verify_id_token(id_token: str) -> dict:
    try:
        decoded = auth.verify_id_token(id_token)
        return {
            "uid": decoded["uid"],
            "email": decoded.get("email", ""),
            "name": decoded.get("name", ""),
            "email_verified": decoded.get("email_verified", False),
        }
    except auth.ExpiredIdTokenError as e:
        logger.warning("Expired ID token: %s", e)
        raise HTTPException(status_code=401, detail="Token expired") from e
    except auth.InvalidIdTokenError as e:
        logger.warning("Invalid ID token: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e
    except Exception as e:
        logger.error("Token verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Token verification failed") from e


def get_or_create_firebase_user(email: str) -> str:
    normalized_email = email.strip().lower()
    try:
        user = auth.get_user_by_email(normalized_email)
        auth.update_user(user.uid, email_verified=True)
        return user.uid
    except auth.UserNotFoundError:
        user = auth.create_user(email=normalized_email, email_verified=True)
        return user.uid


def create_custom_token(uid: str) -> str:
    token = auth.create_custom_token(uid)
    return token.decode("utf-8") if isinstance(token, bytes) else token
