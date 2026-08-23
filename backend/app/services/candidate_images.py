import uuid

CANDIDATE_IMAGE_MAX_COUNT = 10
CANDIDATE_IMAGE_CONTENT_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def candidate_image_key(candidate_id: uuid.UUID, index: int, content_type: str) -> str:
    extension = CANDIDATE_IMAGE_CONTENT_TYPES.get(content_type)
    if extension is None:
        raise ValueError("content type must be image/jpeg, image/png, or image/webp")
    if not 0 <= index < CANDIDATE_IMAGE_MAX_COUNT:
        raise ValueError("image index is out of range")
    return f"candidates/{candidate_id}/{index:02d}.{extension}"
