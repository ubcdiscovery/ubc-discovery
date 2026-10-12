from asyncio import Event

from app.services.extraction.jobs import (
    claim_jobs,
    complete_job,
    delay_job,
    due_job_count,
    enqueue_extraction_job,
    fail_job,
    jobs_to_claim_count,
    queue_is_quiet,
    reclaim_stale_jobs,
)
from app.services.extraction.pipeline import process_claimed_jobs
from app.services.extraction.types import ExtractionResult, Extractor

__all__ = [
    "ExtractionResult",
    "Extractor",
    "claim_jobs",
    "complete_job",
    "delay_job",
    "due_job_count",
    "enqueue_extraction_job",
    "fail_job",
    "jobs_to_claim_count",
    "process_claimed_jobs",
    "queue_is_quiet",
    "reclaim_stale_jobs",
    "run_extraction_worker",
    "run_once",
]


async def run_extraction_worker(stop: Event) -> None:
    """Load the legacy SDK only when the polling worker actually runs."""
    from app.services.extraction.worker import run_extraction_worker as run_worker

    await run_worker(stop)


async def run_once(extractor: Extractor | None = None) -> int:
    from app.services.extraction.worker import run_once as run_legacy_once

    return await run_legacy_once(extractor)
