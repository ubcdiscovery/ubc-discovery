import type { ApiEnv } from "../env";
import { integerSetting } from "../env";
import type { EventListingCandidate } from "../db/schema";
import { ApiError } from "../http/errors";
import type { Delivery } from "../schemas/candidates";
export function captureTimedOut(candidate: EventListingCandidate, now: Date, env: ApiEnv): boolean {
  return (
    now.getTime() - candidate.createdAt.getTime() >=
    integerSetting(env.EXTRACTION_IMAGE_WAIT_SECONDS, 300) * 1000
  );
}
/**
 * Send Candidates to the extraction Queue. Callers send inside the transaction that
 * records the dispatch, so a failed send records nothing and the caller's retry sends again.
 * A send whose transaction then fails leaves a message for a generation the database
 * never recorded as dispatched; it is harmless (the Worker sees the same generation and
 * retries or acknowledges, and duplicate deliveries are idempotent).
 */
export async function enqueueCandidates(env: ApiEnv, candidates: Delivery[]): Promise<void> {
  if (!candidates.length) return;
  try {
    if (!env.EXTRACTION_QUEUE) throw new Error("EXTRACTION_QUEUE binding is not configured");
    await env.EXTRACTION_QUEUE.sendBatch(candidates.map((body) => ({ body })));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "queue_dispatch_failed",
        candidate_ids: candidates.map((item) => item.candidate_id),
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiError(503, "Extraction queue unavailable; retry the request");
  }
}
