"""Shared extraction output contract without an OpenAI SDK dependency."""

from app.schemas.event import EVENT_VIBES

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
