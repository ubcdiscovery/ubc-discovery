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
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        secret.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32
    )
    return f"scrypt$16384$8$1${salt.hex()}${digest.hex()}"


def verify_secret(secret: str, encoded_hash: str) -> bool:
    try:
        algorithm, n, r, p, salt_hex, digest_hex = encoded_hash.split("$")
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(
            secret.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(bytes.fromhex(digest_hex)),
        )
    except TypeError, ValueError:
        return False
    return hmac.compare_digest(digest, bytes.fromhex(digest_hex))


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
