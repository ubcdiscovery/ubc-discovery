import json
import logging
import math
from functools import lru_cache
from typing import TypeGuard

import boto3
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.constants import EVENT_EMBEDDING_DIMENSIONS
from app.models.event import Event

logger = logging.getLogger(__name__)

TITAN_EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0"
VIBE_WEIGHT_DEFAULT = 0.5


def is_valid_embedding(value: object) -> TypeGuard[list[float]]:
    """Return whether a value can be stored in the fixed-size vector column."""
    if not isinstance(value, list) or len(value) != EVENT_EMBEDDING_DIMENSIONS:
        return False
    return all(
        isinstance(component, (int, float))
        and not isinstance(component, bool)
        and math.isfinite(float(component))
        for component in value
    )


@lru_cache
def _bedrock_client():
    return boto3.client("bedrock-runtime", region_name=settings.aws_region)


def generate_event_text(event: Event) -> str:
    parts = [event.title]
    if event.description:
        parts.append(event.description)
    if event.club_name:
        parts.append(f"Hosted by {event.club_name}")
    parts.append(f"Location: {event.location_name}")
    return ". ".join(parts)


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        raise ValueError(f"Vector length mismatch: {len(a)} vs {len(b)}")
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def vibe_jaccard(vibes_a: list[str], vibes_b: list[str]) -> float:
    if not vibes_a or not vibes_b:
        return 0.0
    set_a = set(vibes_a)
    set_b = set(vibes_b)
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def hybrid_score(
    emb_a: list[float],
    emb_b: list[float],
    vibes_a: list[str],
    vibes_b: list[str],
    vibe_weight: float = VIBE_WEIGHT_DEFAULT,
) -> float:
    text_score = cosine_similarity(emb_a, emb_b)
    vibe_score = vibe_jaccard(vibes_a, vibes_b)
    return (1.0 - vibe_weight) * text_score + vibe_weight * vibe_score


def embed_text(text: str) -> list[float] | None:
    try:
        client = _bedrock_client()
        response = client.invoke_model(
            modelId=TITAN_EMBED_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(
                {"inputText": text, "dimensions": EVENT_EMBEDDING_DIMENSIONS}
            ),
        )
        result = json.loads(response["body"].read())
        embedding = result["embedding"]
        if not is_valid_embedding(embedding):
            logger.warning(
                "Titan returned an invalid %d-dimensional embedding "
                "for text: %.100s...",
                EVENT_EMBEDDING_DIMENSIONS,
                text,
            )
            return None
        return embedding
    except Exception:
        logger.exception("Failed to generate embedding for text: %.100s...", text)
        return None


async def generate_event_embedding(event: Event) -> list[float] | None:
    text = generate_event_text(event)
    return embed_text(text)


async def fetch_nearest_events(
    db: AsyncSession,
    embedding: list[float],
    *,
    exclude_event_id: str | None = None,
    limit: int = 100,
) -> list[Event]:
    """Fetch vector-nearest events while leaving JSON ranking available to callers."""
    if not is_valid_embedding(embedding):
        return []

    query = select(Event).where(Event.embedding_vector.is_not(None))
    if exclude_event_id is not None:
        query = query.where(Event.id != exclude_event_id)
    query = query.order_by(
        Event.embedding_vector.cosine_distance(embedding), Event.id
    ).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


def mean_embedding(embeddings: list[list[float]]) -> list[float] | None:
    if not embeddings:
        return None
    dim = len(embeddings[0])
    result = [0.0] * dim
    for emb in embeddings:
        for i in range(dim):
            result[i] += emb[i]
    count = len(embeddings)
    return [v / count for v in result]


def rank_events(
    taste_vector: list[float],
    candidates: list[Event],
    top_n: int = 10,
    vibe_profile: list[str] | None = None,
    vibe_weight: float = VIBE_WEIGHT_DEFAULT,
) -> list[tuple[Event, float]]:
    scored: list[tuple[Event, float]] = []
    effective_vibe_profile = vibe_profile or []
    for event in candidates:
        if not event.embedding:
            continue
        score = hybrid_score(
            taste_vector,
            event.embedding,
            effective_vibe_profile,
            event.vibes or [],
            vibe_weight=vibe_weight,
        )
        scored.append((event, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_n]


def get_similar_events(
    event: Event,
    candidates: list[Event],
    top_n: int = 5,
    vibe_weight: float = VIBE_WEIGHT_DEFAULT,
) -> list[tuple[Event, float]]:
    if not event.embedding:
        scored: list[tuple[Event, float]] = []
        for c in candidates:
            if c.id == event.id:
                continue
            score = vibe_jaccard(event.vibes or [], c.vibes or [])
            if score > 0:
                scored.append((c, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_n]

    scored = []
    for c in candidates:
        if c.id == event.id:
            continue
        if not c.embedding:
            vibe_score = vibe_jaccard(event.vibes or [], c.vibes or [])
            if vibe_score > 0:
                scored.append((c, vibe_score))
            continue
        score = hybrid_score(
            event.embedding,
            c.embedding,
            event.vibes or [],
            c.vibes or [],
            vibe_weight=vibe_weight,
        )
        scored.append((c, score))
    scored.sort(key=lambda x: x[1], reverse=True)
    return scored[:top_n]
