import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CreateRatingRequest(BaseModel):
    stars: int = Field(ge=1, le=5)
    strong_vibes: list[str] = Field(default_factory=list)
    note: str | None = None


class EventRatingResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    user_name: str
    event_id: str
    stars: float
    strong_vibes: list[str]
    note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RatingListResponse(BaseModel):
    ratings: list[EventRatingResponse]
    total: int
