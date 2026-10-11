import json
import logging
import math
from functools import lru_cache
from typing import TypeGuard

import boto3
from pgvector.sqlalchemy import Vector
from sqlalchemy import bindparam, case, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer
from sqlalchemy.sql import Select

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


async def average_saved_embedding(
    db: AsyncSession, saved_event_ids: list[str]
) -> list[float] | None:
    """Build the taste vector in PostgreSQL without transferring saved vectors."""
    average = await db.scalar(
        select(
            func.avg(Event.embedding_vector, type_=Vector(EVENT_EMBEDDING_DIMENSIONS))
        ).where(Event.id.in_(saved_event_ids), Event.is_archived.is_(False))
    )

    return list(average) if average is not None else None


async def _rank_candidates(  # noqa: PLR0913 - explicit ranking inputs
    db: AsyncSession,
    candidates: Select,
    *,
    embedding: list[float] | None,
    vibes: list[str],
    top_n: int,
    vibe_weight: float,
) -> list[tuple[Event, float]]:
    # Materialize the candidate boundary before hybrid ranking (especially the
    # For You recent-200 limit, which precedes the missing-vector filter).
    candidate_rows = candidates.cte("candidates").prefix_with("MATERIALIZED")
    event_vibes = select(
        func.json_array_elements_text(candidate_rows.c.vibes).label("vibe")
    ).correlate(candidate_rows)
    profile_vibes = select(
        func.jsonb_array_elements_text(
            bindparam("profile_vibes", value=vibes, type_=JSONB)
        ).label("vibe")
    )
    intersection = event_vibes.intersect(profile_vibes).subquery()
    union = event_vibes.union(profile_vibes).subquery()
    shared_count = select(func.count()).select_from(intersection).scalar_subquery()
    total_count = select(func.count()).select_from(union).scalar_subquery()
    vibe_score = func.coalesce(shared_count * 1.0 / func.nullif(total_count, 0), 0.0)
    ranking = select(candidate_rows.c.id)
    if embedding is None:
        score = vibe_score
        ranking = ranking.where(vibe_score > 0)
    else:
        query_vector = bindparam(
            "query_vector", value=embedding, type_=Vector(EVENT_EMBEDDING_DIMENSIONS)
        )
        cosine = case(
            (
                (func.vector_norm(candidate_rows.c.embedding_vector) == 0)
                | (func.vector_norm(query_vector) == 0),
                0.0,
            ),
            else_=1.0 - candidate_rows.c.embedding_vector.cosine_distance(query_vector),
        )
        score = (1.0 - vibe_weight) * cosine + vibe_weight * vibe_score
        ranking = ranking.where(candidate_rows.c.embedding_vector.is_not(None))
    ranked = (
        ranking.add_columns(score.label("score"))
        .order_by(score.desc(), candidate_rows.c.id)
        .limit(top_n)
        .cte("ranked")
    )
    result = await db.execute(
        select(Event, ranked.c.score)
        .join(ranked, Event.id == ranked.c.id)
        .options(defer(Event.embedding_vector))
        .order_by(ranked.c.score.desc(), Event.id),
    )
    return [(event, float(score)) for event, score in result.all()]


async def similar_events(
    db: AsyncSession, source: Event, *, top_n: int, vibe_weight: float
) -> list[tuple[Event, float]]:
    candidates = select(Event.id, Event.embedding_vector, Event.vibes).where(
        Event.id != source.id, Event.is_archived.is_(False)
    )
    if source.embedding_vector is not None:
        candidates = (
            candidates.where(Event.embedding_vector.is_not(None))
            .order_by(
                Event.embedding_vector.cosine_distance(source.embedding_vector),
                Event.id,
            )
            .limit(max(100, top_n * 20))
        )
    return await _rank_candidates(
        db,
        candidates,
        embedding=source.embedding_vector,
        vibes=list(source.vibes or []),
        top_n=top_n,
        vibe_weight=vibe_weight,
    )


async def personalized_events(
    db: AsyncSession,
    *,
    embedding: list[float],
    saved_event_ids: list[str],
    vibes: list[str],
    top_n: int,
) -> list[tuple[Event, float]]:
    candidates = (
        select(Event.id, Event.embedding_vector, Event.vibes)
        .where(Event.id.notin_(saved_event_ids), Event.is_archived.is_(False))
        .order_by(Event.event_date.desc().nullslast(), Event.id)
        .limit(200)
    )
    return await _rank_candidates(
        db,
        candidates,
        embedding=embedding,
        vibes=vibes,
        top_n=top_n,
        vibe_weight=VIBE_WEIGHT_DEFAULT,
    )
