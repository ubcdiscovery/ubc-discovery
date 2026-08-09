from app.models.event import Event
from app.schemas.event import EventResponse
from app.services import s3


def event_image_key(event_id: str) -> str:
    return f"event-pictures/{event_id}.webp"


def event_to_response(event: Event) -> EventResponse:
    response = EventResponse.model_validate(event)
    if event.event_picture_key:
        response.event_picture_url = s3.public_url(event.event_picture_key)
    return response
