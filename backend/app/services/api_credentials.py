"""Generation, parsing, and verification for managed ingestion credentials."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid

TOKEN_PREFIX = "ubc_live_"


def generate_secret() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(secret: str) -> str:
    """Digest a server-generated high-entropy secret for storage.

    This is intentionally not a password KDF: secrets are generated with
    256 bits of randomness and are never supplied by users.
    """
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def verify_secret(secret: str, encoded_hash: str) -> bool:
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    return hmac.compare_digest(digest, encoded_hash)


def format_token(credential_id: uuid.UUID, secret: str) -> str:
    return f"{TOKEN_PREFIX}{credential_id}.{secret}"


def parse_token(token: str) -> tuple[uuid.UUID, str] | None:
    if not token.startswith(TOKEN_PREFIX):
        return None
    value = token[len(TOKEN_PREFIX) :]
    if value.count(".") != 1:
        return None
    credential_id_text, secret = value.split(".", 1)
    if not secret or any(character.isspace() for character in secret):
        return None
    try:
        credential_id = uuid.UUID(credential_id_text)
    except ValueError:
        return None
    return credential_id, secret
