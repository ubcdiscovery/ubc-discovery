import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import FirebaseIdentity, get_current_user, get_firebase_identity
from app.models.user import User
from app.schemas.user import (
    OnboardingRequest,
    PresignedUploadResponse,
    UpdateProfileRequest,
    UserResponse,
    UserStatsResponse,
)
from app.services import s3

router = APIRouter(prefix="/users", tags=["Users"])


def _profile_picture_key() -> str:
    return f"profile-pictures/{uuid.uuid4()}"


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    response = UserResponse.model_validate(current_user)
    if current_user.profile_picture_key:
        response.profile_picture_url = s3.public_url(current_user.profile_picture_key)
    return response


def _is_ubc_email(addr: str) -> bool:
    domain = addr.lower().split("@")[-1]
    return domain == "ubc.ca" or domain.endswith(".ubc.ca")


@router.post("/onboarding", response_model=UserResponse)
async def complete_onboarding(
    body: OnboardingRequest,
    identity: FirebaseIdentity = Depends(get_firebase_identity),
    db: AsyncSession = Depends(get_db),
):

    result = await db.execute(select(User).where(User.firebase_uid == identity.uid))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User already exists")

    user = User(
        firebase_uid=identity.uid,
        email=identity.email,
        preferred_name=body.preferred_name,
        major=body.major,
        year_standing=body.year_standing,
        faculty=body.faculty,
        interests=body.interests,
        bio=body.bio,
        ubc_verified=_is_ubc_email(identity.email),
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.put("/me", response_model=UserResponse)
async def update_profile(
    body: UpdateProfileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    await db.commit()
    await db.refresh(current_user)
    response = UserResponse.model_validate(current_user)
    if current_user.profile_picture_key:
        response.profile_picture_url = s3.public_url(current_user.profile_picture_key)
    return response


@router.get("/me/presigned-upload", response_model=PresignedUploadResponse)
async def get_presigned_upload(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    content_type = "image/webp"
    if current_user.profile_picture_key:
        s3.delete_object(current_user.profile_picture_key)
    url, fields, file_key = s3.generate_presigned_upload_url(
        content_type=content_type,
        file_key=_profile_picture_key(),
        max_file_size_bytes=settings.profile_photo_max_bytes,
    )
    current_user.profile_picture_key = file_key
    await db.commit()
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        file_key=file_key,
        max_file_size_bytes=settings.profile_photo_max_bytes,
    )


@router.get("/me/stats", response_model=UserStatsResponse)
async def get_stats(current_user: User = Depends(get_current_user)):
    return UserStatsResponse(
        member_since=current_user.created_at,
    )
