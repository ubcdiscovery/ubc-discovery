from app.models.event_listing_candidate import EventListingCandidate
from app.schemas.event_listing_candidate import EventListingCandidateResponse
from app.services import s3


def candidate_to_response(
    candidate: EventListingCandidate,
) -> EventListingCandidateResponse:
    response = EventListingCandidateResponse.model_validate(candidate)
    response.image_urls = [
        s3.generate_presigned_download_url(key) for key in candidate.image_keys or []
    ]
    return response
