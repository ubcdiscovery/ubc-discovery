from __future__ import annotations

import asyncio
import logging

from app.config import settings
from app.database import async_session
from app.models.event_listing_candidate import CandidateExtractionJob
from app.services.extraction.extractors.openai_vision import OpenAIVisionExtractor
from app.services.extraction.jobs import (
    claim_jobs,
    jobs_to_claim_count,
    reclaim_stale_jobs,
)
from app.services.extraction.pipeline import process_claimed_jobs
from app.services.extraction.types import Extractor

logger = logging.getLogger(__name__)


async def run_once(extractor: Extractor | None = None) -> int:
    worker_extractor = extractor or OpenAIVisionExtractor()
    async with async_session() as session:
        await reclaim_stale_jobs(session)
        limit = await jobs_to_claim_count(session)
        jobs = await claim_jobs(session, limit)
        job_ids = [job.id for job in jobs]
        await session.commit()

    if not job_ids:
        return 0

    async with async_session() as session:
        attached = []
        for job_id in job_ids:
            loaded = await session.get(CandidateExtractionJob, job_id)
            if loaded is not None:
                attached.append(loaded)
        await process_claimed_jobs(session, attached, worker_extractor)
        await session.commit()
    return len(job_ids)


async def run_extraction_worker(stop: asyncio.Event) -> None:
    extractor = OpenAIVisionExtractor()
    logger.info("Candidate extraction worker started")
    while not stop.is_set():
        try:
            processed = await run_once(extractor)
        except Exception:
            logger.exception("Candidate extraction worker loop failed")
            processed = 0
        timeout = (
            settings.extraction_poll_seconds
            if processed
            else settings.extraction_idle_seconds
        )
        try:
            await asyncio.wait_for(stop.wait(), timeout=timeout)
        except TimeoutError:
            continue
