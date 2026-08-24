from __future__ import annotations

from app.models.event_listing_candidate import EventListingCandidate
from app.services import s3
from app.services.extraction.types import EvidenceImage, ExtractionEvidence

_MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def _media_type(key: str) -> str:
    lowered = key.lower()
    for suffix, media_type in _MEDIA_TYPES.items():
        if lowered.endswith(suffix):
            return media_type
    return "image/jpeg"


def assemble_evidence(candidate: EventListingCandidate) -> ExtractionEvidence:
    images: list[EvidenceImage] = []
    pending: list[str] = []
    for key in candidate.image_keys or []:
        if not s3.object_exists(key):
            pending.append(key)
            continue
        images.append(
            EvidenceImage(
                key=key,
                media_type=_media_type(key),
                content=s3.get_object_bytes(key),
            )
        )
    return ExtractionEvidence(
        candidate_id=candidate.id,
        caption=candidate.description,
        source_account=candidate.source_account,
        source_type=candidate.source_type,
        posted_at=candidate.posted_at,
        created_at=candidate.created_at,
        images=tuple(images),
        pending_image_keys=tuple(pending),
    )
