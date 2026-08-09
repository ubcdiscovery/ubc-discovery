from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func as sa_func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.event import Event
from app.models.event_submission import (
    SUBMISSION_APPROVED,
    SUBMISSION_PENDING,
    SUBMISSION_REJECTED,
    EventSubmission,
)
from app.models.user import User
from app.presenters.event import event_to_response
from app.presenters.event_submission import (
    submission_image_key,
    submission_to_response,
)
from app.schemas.event import EventResponse
from app.schemas.event_submission import (
    CreateEventSubmissionRequest,
    EventSubmissionListResponse,
    EventSubmissionResponse,
    ReviewSubmissionRequest,
)
from app.schemas.user import PresignedUploadResponse
from app.services import recommender
from app.services import s3

router = APIRouter(prefix="/event-submissions", tags=["Event submissions"])

# Cap on how many submissions one member may have awaiting review at once.
MAX_PENDING_SUBMISSIONS = 5

SUBMISSION_STATUSES = (SUBMISSION_PENDING, SUBMISSION_APPROVED, SUBMISSION_REJECTED)


async def _get_pending_submission(
    submission_id: str, db: AsyncSession
) -> EventSubmission:
    result = await db.execute(
        select(EventSubmission).where(EventSubmission.id == submission_id)
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.status != SUBMISSION_PENDING:
        raise HTTPException(
            status_code=409,
            detail=f"Submission has already been {submission.status}",
        )
    return submission


@router.post("", response_model=EventSubmissionResponse, status_code=201)
async def create_submission(
    body: CreateEventSubmissionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit an event for review. It stays off Discover until approved."""
    result = await db.execute(
        select(sa_func.count())
        .select_from(EventSubmission)
        .where(
            EventSubmission.submitted_by_id == current_user.id,
            EventSubmission.status == SUBMISSION_PENDING,
        )
    )
    if result.scalar_one() >= MAX_PENDING_SUBMISSIONS:
        raise HTTPException(
            status_code=429,
            detail=(
                f"You already have {MAX_PENDING_SUBMISSIONS} submissions awaiting "
                "review. Wait for those to be reviewed before sending more."
            ),
        )

    submission = EventSubmission(
        submitted_by_id=current_user.id,
        **body.model_dump(),
    )
    db.add(submission)
    await db.commit()
    await db.refresh(submission)
    return submission_to_response(submission)


@router.get("/mine", response_model=EventSubmissionListResponse)
async def list_my_submissions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Everything the signed-in member has submitted, newest first."""
    result = await db.execute(
        select(EventSubmission)
        .where(EventSubmission.submitted_by_id == current_user.id)
        .order_by(EventSubmission.created_at.desc())
    )
    submissions = list(result.scalars().all())
    return EventSubmissionListResponse(
        submissions=[
            submission_to_response(s) for s in submissions
        ],
        total=len(submissions),
    )


@router.get(
    "",
    response_model=EventSubmissionListResponse,
    dependencies=[Depends(require_admin)],
)
async def list_submissions(
    status: str = Query(default=SUBMISSION_PENDING),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Review queue. Defaults to what is still awaiting a decision."""
    if status not in SUBMISSION_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {', '.join(SUBMISSION_STATUSES)}",
        )

    base = select(EventSubmission).where(EventSubmission.status == status)

    total_result = await db.execute(
        select(sa_func.count()).select_from(base.subquery())
    )
    result = await db.execute(
        base.order_by(EventSubmission.created_at.asc()).offset(skip).limit(limit)
    )
    return EventSubmissionListResponse(
        submissions=[
            submission_to_response(s) for s in result.scalars().all()
        ],
        total=total_result.scalar_one(),
    )


@router.post(
    "/{submission_id}/approve",
    response_model=EventResponse,
    dependencies=[Depends(require_admin)],
)
async def approve_submission(
    submission_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Publish a pending submission as a real event."""
    submission = await _get_pending_submission(submission_id, db)

    event = Event(
        title=submission.title,
        description=submission.description,
        source="submission",
        source_label=submission.source_label,
        source_url=submission.source_url,
        external_cta_label=submission.external_cta_label,
        club_name=submission.club_name,
        vibes=submission.vibes,
        location_name=submission.location_name,
        event_date=submission.event_date,
        event_end_date=submission.event_end_date,
        event_picture_key=submission.event_picture_key,
    )
    db.add(event)
    await db.flush()

    submission.status = SUBMISSION_APPROVED
    submission.reviewed_at = datetime.now(timezone.utc)
    submission.published_event_id = event.id
    await db.commit()
    await db.refresh(event)

    embedding = await recommender.generate_event_embedding(event)
    if embedding is not None:
        event.embedding = embedding
        await db.commit()

    return event_to_response(event)


@router.post(
    "/{submission_id}/reject",
    response_model=EventSubmissionResponse,
    dependencies=[Depends(require_admin)],
)
async def reject_submission(
    submission_id: str,
    body: ReviewSubmissionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Decline a pending submission, optionally saying why."""
    submission = await _get_pending_submission(submission_id, db)

    submission.status = SUBMISSION_REJECTED
    submission.review_note = body.review_note
    submission.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(submission)
    return submission_to_response(submission)


@router.post(
    "/{submission_id}/presigned-upload",
    response_model=PresignedUploadResponse,
)
async def get_submission_presigned_upload(
    submission_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Issue a direct-to-S3 upload for the organizer's cover image."""
    result = await db.execute(
        select(EventSubmission).where(EventSubmission.id == submission_id)
    )
    submission = result.scalar_one_or_none()
    if not submission or submission.submitted_by_id != current_user.id:
        raise HTTPException(status_code=404, detail="Submission not found")
    if submission.status != SUBMISSION_PENDING:
        raise HTTPException(
            status_code=409,
            detail="This submission has already been reviewed.",
        )

    url, fields, file_key = s3.generate_presigned_upload_url(
        content_type="image/webp",
        file_key=submission_image_key(submission.id),
        max_file_size_bytes=settings.event_image_max_bytes,
    )
    submission.event_picture_key = file_key
    await db.commit()
    return PresignedUploadResponse(
        upload_url=url,
        fields=fields,
        file_key=file_key,
        max_file_size_bytes=settings.event_image_max_bytes,
    )
