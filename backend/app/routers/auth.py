import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func as sa_func
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models.otp_code import OTPCode
from app.models.user import User
from app.schemas.auth import (
    OTPSendRequest,
    OTPSendResponse,
    OTPVerifyRequest,
    OTPVerifyResponse,
    UBCVerifyConfirmRequest,
    UBCVerifySendRequest,
)
from app.schemas.user import UserResponse
from app.services import email as email_service
from app.services import firebase_auth

router = APIRouter(prefix="/auth", tags=["Auth"])


def _auth_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _is_ubc_email(addr: str) -> bool:
    domain = addr.lower().split("@")[-1]
    return domain == "ubc.ca" or domain.endswith(".ubc.ca")


def _generate_otp() -> str:
    return str(secrets.randbelow(900000) + 100000)


async def _check_rate_limit(email: str, db: AsyncSession) -> None:
    cutoff = datetime.now(UTC) - timedelta(minutes=15)
    result = await db.execute(
        select(sa_func.count())
        .select_from(OTPCode)
        .where(OTPCode.email == email.lower(), OTPCode.created_at >= cutoff)
    )
    count = result.scalar_one()
    if count >= settings.otp_rate_limit_per_15min:
        raise _auth_error(
            429,
            "OTP_RATE_LIMITED",
            "Too many requests. Try again later.",
        )


async def _create_and_send_otp(email: str, db: AsyncSession) -> int:
    await _check_rate_limit(email, db)

    await db.execute(
        update(OTPCode)
        .where(OTPCode.email == email.lower(), OTPCode.used.is_(False))
        .values(used=True)
    )

    code = _generate_otp()
    otp = OTPCode(
        email=email.lower(),
        code=code,
        expires_at=datetime.now(UTC) + timedelta(minutes=settings.otp_expiry_minutes),
    )
    db.add(otp)
    await db.commit()

    try:
        await email_service.send_otp_email(email, code)
    except email_service.EmailDeliveryError as exc:
        raise _auth_error(
            500,
            "OTP_DELIVERY_FAILED",
            "Failed to send verification email.",
        ) from exc

    return settings.otp_expiry_minutes * 60


async def _verify_otp_code(email: str, code: str, db: AsyncSession) -> OTPCode:
    now = datetime.now(UTC)
    result = await db.execute(
        select(OTPCode)
        .where(
            OTPCode.email == email.lower(),
            OTPCode.used.is_(False),
            OTPCode.expires_at > now,
        )
        .order_by(OTPCode.created_at.desc())
        .limit(1)
    )
    otp = result.scalar_one_or_none()

    if not otp:
        raise _auth_error(
            400,
            "OTP_EXPIRED",
            "No valid code found. Request a new one.",
        )

    if otp.attempts >= settings.otp_max_attempts:
        otp.used = True
        await db.commit()
        raise _auth_error(
            400,
            "OTP_TOO_MANY_ATTEMPTS",
            "Too many attempts. Request a new code.",
        )

    if otp.code != code:
        otp.attempts += 1
        await db.commit()
        raise _auth_error(400, "OTP_INVALID", "Invalid code.")

    otp.used = True
    await db.commit()
    return otp


@router.post("/otp/send", response_model=OTPSendResponse)
async def send_otp(body: OTPSendRequest, db: AsyncSession = Depends(get_db)):
    expires_in = await _create_and_send_otp(body.email, db)
    return OTPSendResponse(
        message="If this email is valid, you'll receive a verification code.",
        expires_in_seconds=expires_in,
    )


@router.post("/otp/verify", response_model=OTPVerifyResponse)
async def verify_otp(body: OTPVerifyRequest, db: AsyncSession = Depends(get_db)):
    await _verify_otp_code(body.email, body.code, db)

    uid = firebase_auth.get_or_create_firebase_user(body.email)
    token = firebase_auth.create_custom_token(uid)

    result = await db.execute(select(User).where(User.firebase_uid == uid))
    existing_user = result.scalar_one_or_none()

    return OTPVerifyResponse(
        firebase_custom_token=token,
        is_new_user=existing_user is None,
        ubc_verified=_is_ubc_email(body.email),
    )


@router.post("/ubc-verify/send", response_model=OTPSendResponse)
async def send_ubc_verify(
    body: UBCVerifySendRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _is_ubc_email(body.email):
        raise HTTPException(
            status_code=400, detail="Must be a UBC email address (*.ubc.ca)."
        )

    if current_user.ubc_verified:
        raise HTTPException(status_code=400, detail="Already verified.")

    expires_in = await _create_and_send_otp(body.email, db)
    return OTPSendResponse(
        message="Verification code sent to your UBC email.",
        expires_in_seconds=expires_in,
    )


@router.post("/ubc-verify/confirm", response_model=UserResponse)
async def confirm_ubc_verify(
    body: UBCVerifyConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not _is_ubc_email(body.email):
        raise HTTPException(
            status_code=400, detail="Must be a UBC email address (*.ubc.ca)."
        )

    await _verify_otp_code(body.email, body.code, db)

    current_user.ubc_verified = True
    await db.commit()
    await db.refresh(current_user)
    return UserResponse.model_validate(current_user)
