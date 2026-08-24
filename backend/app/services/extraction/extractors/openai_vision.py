from __future__ import annotations

import base64
import json
from datetime import datetime
from uuid import UUID

from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionContentPartParam,
    ChatCompletionMessageParam,
)
from openai.types.shared_params.response_format_json_schema import (
    ResponseFormatJSONSchema,
)

from app.config import settings
from app.schemas.event import EVENT_SOURCE_LABELS, EVENT_VIBES
from app.services.extraction.prompts import SYSTEM_PROMPT
from app.services.extraction.types import ExtractionEvidence, ExtractionResult

_ITEM_PROPERTIES = {
    "candidate_id": {"type": "string"},
    "is_event": {"type": "boolean"},
    "title": {"type": ["string", "null"]},
    "event_date": {"type": ["string", "null"]},
    "event_end_date": {"type": ["string", "null"]},
    "location_name": {"type": ["string", "null"]},
    "club_name": {"type": ["string", "null"]},
    "vibes": {
        "type": "array",
        "items": {"type": "string", "enum": list(EVENT_VIBES)},
    },
    "source_label": {
        "anyOf": [
            {"type": "string", "enum": list(EVENT_SOURCE_LABELS)},
            {"type": "null"},
        ]
    },
}

RESPONSE_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "extractions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": _ITEM_PROPERTIES,
                "required": list(_ITEM_PROPERTIES.keys()),
            },
        }
    },
    "required": ["extractions"],
}


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _result_from_payload(payload: dict) -> ExtractionResult:
    vibes = tuple(vibe for vibe in payload.get("vibes") or [] if vibe in EVENT_VIBES)
    source_label = payload.get("source_label")
    if source_label not in EVENT_SOURCE_LABELS:
        source_label = None
    return ExtractionResult(
        candidate_id=UUID(str(payload["candidate_id"])),
        is_event=bool(payload.get("is_event")),
        title=payload.get("title") or None,
        event_date=_parse_datetime(payload.get("event_date")),
        event_end_date=_parse_datetime(payload.get("event_end_date")),
        location_name=payload.get("location_name") or None,
        club_name=payload.get("club_name") or None,
        vibes=vibes,
        source_label=source_label,
        raw=payload,
    )


class OpenAIVisionExtractor:
    def __init__(self, client: AsyncOpenAI | None = None) -> None:
        self._client = client or AsyncOpenAI(api_key=settings.openai_api_key)

    async def extract_many(
        self, items: list[ExtractionEvidence]
    ) -> list[ExtractionResult]:
        if not items:
            return []
        user_content: list[ChatCompletionContentPartParam] = []
        for item in items:
            reference = item.posted_at or item.created_at
            user_content.append(
                {
                    "type": "text",
                    "text": (
                        f"candidate_id: {item.candidate_id}\n"
                        f"source_account: @{item.source_account}\n"
                        f"source_type: {item.source_type}\n"
                        f"reference_timestamp: {reference.isoformat()}\n"
                        f"caption:\n{item.caption}"
                    ),
                }
            )
            for image in item.images:
                encoded = base64.b64encode(image.content).decode()
                user_content.append(
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{image.media_type};base64,{encoded}",
                            "detail": settings.extraction_image_detail,
                        },
                    }
                )

        messages: list[ChatCompletionMessageParam] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]
        response_format: ResponseFormatJSONSchema = {
            "type": "json_schema",
            "json_schema": {
                "name": "candidate_extractions",
                "strict": True,
                "schema": RESPONSE_SCHEMA,
            },
        }
        response = await self._client.chat.completions.create(
            model=settings.extraction_model,
            reasoning_effort=settings.extraction_reasoning_effort,
            messages=messages,
            response_format=response_format,
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)
        by_id = {
            result.candidate_id: result
            for result in (
                _result_from_payload(item) for item in parsed.get("extractions") or []
            )
        }
        ordered = [
            by_id[item.candidate_id] for item in items if item.candidate_id in by_id
        ]
        if len(ordered) != len(items):
            raise ValueError("extractor returned the wrong candidate set")
        return ordered
