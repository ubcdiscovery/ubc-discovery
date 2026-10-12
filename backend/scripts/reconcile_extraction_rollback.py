"""Dry-run legacy job repair; --apply commits after processors are stopped."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.database import async_session, engine
from app.services.extraction.rollback import reconcile_legacy_jobs


async def run(*, apply: bool) -> None:
    try:
        async with async_session() as session:
            outcomes = await reconcile_legacy_jobs(session, apply=apply)
            if apply:
                await session.commit()
            else:
                await session.rollback()
        summary = ", ".join(
            f"{action.value}={count}" for action, count in sorted(outcomes.items())
        )
        print(f"{'Applied' if apply else 'Dry run'}: {summary or 'no candidates'}")
    finally:
        await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="commit reconciled jobs")
    parser.add_argument(
        "--processors-stopped",
        action="store_true",
        help="acknowledge that all producers and extraction processors are stopped",
    )
    args = parser.parse_args()
    if args.apply and not args.processors_stopped:
        parser.error("--apply requires --processors-stopped; see the rollback runbook")
    if args.apply and settings.extraction_enabled:
        parser.error("set EXTRACTION_ENABLED=false before applying rollback repair")
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
