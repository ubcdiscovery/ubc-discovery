from app.models.event_submission import EventSubmission
from app.schemas.event_submission import EventSubmissionResponse
from app.services import s3


def submission_image_key(submission_id) -> str:
    return f"submission-pictures/{submission_id}.webp"


def submission_to_response(submission: EventSubmission) -> EventSubmissionResponse:
    response = EventSubmissionResponse.model_validate(submission)
    if submission.event_picture_key:
        response.event_picture_url = s3.public_url(submission.event_picture_key)
    return response
