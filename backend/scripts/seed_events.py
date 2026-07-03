"""Seed UBC events via the API. Requires ADMIN_API_KEY.

Dates are computed relative to today so seed data always produces future events.

Usage:
    ADMIN_API_KEY=secret uv run python scripts/seed_events.py
    ADMIN_API_KEY=secret uv run python scripts/seed_events.py --api-url https://api.example.com
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone

import httpx


def _dt(day_offset: int, hour: int, minute: int = 0) -> str:
    """Return an ISO-8601 UTC timestamp *day_offset* days from today at the given hour."""
    t = datetime.now(timezone.utc).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    t += timedelta(days=day_offset)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


UBC_EVENTS = [
    {
        "title": "SEEDS Sustainability Symposium",
        "description": "A showcase of student-led research that uses the UBC campus as a 'living lab.' Innovative projects on urban biodiversity, waste reduction, and climate resilience.",
        "source_label": "ubc_official",
        "source_url": "https://sustain.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["academic", "volunteering", "wellness"],
        "club_name": "SEEDS Sustainability",
        "location_name": "CIRS (2260 West Mall)",
        "event_date": _dt(3, 9),
        "event_end_date": _dt(3, 16),
    },
    {
        "title": "Science Rendezvous",
        "description": "Part of a national science festival, legendary for hands-on experiments like 'Liquid Nitrogen Ice Cream' and 'Mysterious Minerals'.",
        "source_label": "ubc_official",
        "source_url": "https://science.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["academic", "social"],
        "club_name": "Science Rendezvous",
        "location_name": "Beaty Biodiversity Museum (2212 Main Mall)",
        "event_date": _dt(5, 10),
        "event_end_date": _dt(5, 16),
    },
    {
        "title": "Morning Bird Walk",
        "description": "Led by expert birders, focusing on identifying spring migrating species. Explore diverse habitats from forest floor to canopy.",
        "source_label": "ubc_official",
        "source_url": "https://botanicalgarden.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["outdoors", "wellness"],
        "club_name": "Botanical Garden",
        "location_name": "UBC Botanical Garden (6804 SW Marine Dr)",
        "event_date": _dt(7, 7),
        "event_end_date": _dt(7, 9),
    },
    {
        "title": "Summer Session Residence Move-In",
        "description": "Primary move-in day for students enrolled in the Summer Term. The campus will be busy with new arrivals.",
        "source_label": "ubc_official",
        "source_url": "https://vancouver.housing.ubc.ca/",
        "external_cta_label": "View details",
        "vibes": ["social"],
        "club_name": "UBC Housing",
        "location_name": "Various Student Residences (Marine Drive Hub)",
        "event_date": _dt(10, 9),
        "event_end_date": _dt(10, 17),
    },
    {
        "title": "Summer Session Term 1 Official Start",
        "description": "The first day of the 2026 Summer Session. Fast-paced accelerated courses begin campus-wide.",
        "source_label": "ubc_official",
        "source_url": "https://students.ubc.ca/enrolment/courses/summer-session",
        "external_cta_label": "View academic dates",
        "vibes": ["academic"],
        "club_name": "UBC Academic",
        "location_name": "Campus-wide (AMS Nest)",
        "event_date": _dt(12, 8),
        "event_end_date": _dt(12, 17),
    },
    {
        "title": "Chung | Lind Gallery Drop-In Tour",
        "description": "Archivists lead this tour through rare maps, photographs, and artifacts focused on the history of the Gold Rush and Chinese immigration.",
        "source_label": "ubc_official",
        "source_url": "https://about.library.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["culture", "arts", "academic"],
        "club_name": "IKB Gallery",
        "location_name": "IKB Learning Centre (1961 East Mall)",
        "event_date": _dt(14, 13, 30),
        "event_end_date": _dt(14, 15),
    },
    {
        "title": "T-Birds in Tech & Sauder Rooftop BBQ",
        "description": "High-profile networking event with tech leaders, local alumni, and students for informal networking and BBQ.",
        "source_label": "ubc_official",
        "source_url": "https://www.sauder.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["career", "food", "social"],
        "club_name": "UBC Sauder",
        "location_name": "UBC Sauder (2053 Main Mall)",
        "event_date": _dt(17, 17),
        "event_end_date": _dt(17, 20),
    },
    {
        "title": "Biodiversity Farm Tour",
        "description": "A guided walk through the 24-hectare working farm. Highlights agroecology and organic crop production.",
        "source_label": "ubc_official",
        "source_url": "https://ubcfarm.ubc.ca/",
        "external_cta_label": "View organizer page",
        "vibes": ["outdoors", "wellness", "volunteering"],
        "club_name": "UBC Farm",
        "location_name": "UBC Farm (3461 Ross Drive)",
        "event_date": _dt(20, 10),
        "event_end_date": _dt(20, 12, 30),
    },
    {
        "title": "MOA Exhibition: 'I Use My Haida Eyes'",
        "description": "World premiere of history robes by Haida artist Jut-ke-Nay Hazel Wilson. Opening night documents Haida perspectives.",
        "source_label": "ubc_official",
        "source_url": "https://moa.ubc.ca/",
        "external_cta_label": "View exhibition",
        "vibes": ["arts", "culture"],
        "club_name": "MOA",
        "location_name": "Museum of Anthropology (6393 NW Marine Dr)",
        "event_date": _dt(24, 18),
        "event_end_date": _dt(24, 21),
    },
]


def main():
    parser = argparse.ArgumentParser(description="Seed UBC events via the API")
    parser.add_argument(
        "--api-url", default="http://localhost:8000", help="Base API URL"
    )
    args = parser.parse_args()

    api_key = os.environ.get("ADMIN_API_KEY")
    if not api_key:
        print("Error: ADMIN_API_KEY environment variable is required")
        sys.exit(1)

    headers = {"Authorization": f"Api-Key {api_key}"}
    url = f"{args.api_url.rstrip('/')}/events"

    created = 0
    failed = 0
    with httpx.Client() as client:
        for event in UBC_EVENTS:
            resp = client.post(url, json=event, headers=headers)
            if resp.status_code == 200:
                created += 1
                print(f"  Created: {event['title']}")
            else:
                failed += 1
                print(f"  FAILED:  {event['title']} — {resp.status_code} {resp.text}")

    print(f"\nDone: {created} created, {failed} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
