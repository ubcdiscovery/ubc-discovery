"""One-time backfill: run Candidate auto-publication over the pending queue.

Reference for the 2026-08 backfill of Candidates that were extracted before
auto-publication shipped. Nothing schedules or imports this script; it only
runs when invoked manually:

    uv run python scripts/auto_publish_backfill.py             # dry run
    uv run python scripts/auto_publish_backfill.py --commit    # apply

Each pending Candidate goes through the same decision as the extraction
worker. Only complete AMS Club Candidates are eligible, and every source or
same-club same-day hold stays pending for human review. Historical same-day
pairs therefore both remain pending rather than selecting an automatic winner.
Safe to re-run; already-decided Candidates are skipped.

Requires DATABASE_URL (backend/.env is loaded by app settings).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

# Run directly from the backend directory; make the app package importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models.event_listing_candidate import (
    CandidateStatus,
    EventListingCandidate,
)
from app.services.candidate_publication import (
    AutoPublicationOutcome,
    preview_auto_publication,
    process_auto_publication,
)


async def backfill_candidates(
    session: AsyncSession, *, commit: bool, chunk_size: int
) -> Counter[str]:
    if chunk_size < 1:
        raise ValueError("chunk_size must be at least 1")
    outcomes: Counter[str] = Counter()
    candidate_ids = (
        await session.scalars(
            select(EventListingCandidate.id)
            .where(EventListingCandidate.status == CandidateStatus.PENDING)
            .order_by(
                EventListingCandidate.created_at.asc(),
                EventListingCandidate.id.asc(),
            )
        )
    ).all()
    for index, candidate_id in enumerate(candidate_ids, start=1):
        candidate = await session.get(EventListingCandidate, candidate_id)
        if candidate is None:
            continue
        try:
            if commit:
                async with session.begin_nested():
                    outcome = await process_auto_publication(session, candidate)
            else:
                outcome = await preview_auto_publication(session, candidate)
        except (ValidationError, IntegrityError) as exc:
            # Withheld like in the worker: stays pending for human review.
            print(f"{candidate_id}: withheld ({exc.__class__.__name__})")
            outcome = AutoPublicationOutcome.PENDING
        except Exception as exc:
            print(f"{candidate_id}: error, left pending: {exc!r}")
            outcome = AutoPublicationOutcome.PENDING
        outcomes[outcome.value] += 1
        if outcome is not AutoPublicationOutcome.PENDING:
            message = outcome.value if commit else "would publish"
            print(f"{candidate_id}: {message}")
        if commit and index % chunk_size == 0:
            await session.commit()
    if commit:
        await session.commit()
    return outcomes


async def run(commit: bool, chunk_size: int) -> None:
    async with async_session() as session:
        outcomes = await backfill_candidates(
            session, commit=commit, chunk_size=chunk_size
        )
    summary = (
        ", ".join(f"{name}={count}" for name, count in sorted(outcomes.items()))
        or "no outcomes"
    )
    print(f"processed {sum(outcomes.values())} candidates ({summary}; commit={commit})")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Candidate auto-publication over the pending queue."
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="apply outcomes; without this flag the run is a dry run",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=25,
        help="candidates between commits when applying (default: 25)",
    )
    args = parser.parse_args()
    asyncio.run(run(commit=args.commit, chunk_size=args.chunk_size))


if __name__ == "__main__":
    main()
