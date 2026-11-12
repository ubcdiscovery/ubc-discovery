import { inArray } from "drizzle-orm";
import type { DbTransaction } from "../db";
import type { ApiEnv } from "../env";
import { integerSetting } from "../env";
import { eventListingCandidates, type EventListingCandidate } from "../db/schema";
import { ApiError } from "../http/errors";
import type { Delivery } from "../schemas/candidates";
export function captureTimedOut(candidate: EventListingCandidate, now: Date, env: ApiEnv): boolean {
  return (
    now.getTime() - candidate.createdAt.getTime() >=
    integerSetting(env.EXTRACTION_IMAGE_WAIT_SECONDS, 300) * 1000
  );
}
export async function dispatchCandidates(
  tx: DbTransaction,
  env: ApiEnv,
  now: Date,
  deliveries: Delivery[],
): Promise<void> {
  if (!deliveries.length) return;
  await tx
    .update(eventListingCandidates)
    .set({ processingDispatchedAt: now })
    .where(
      inArray(
        eventListingCandidates.id,
        deliveries.map((item) => item.candidate_id),
      ),
    );
  try {
    if (!env.EXTRACTION_QUEUE) throw new Error("EXTRACTION_QUEUE binding is not configured");
    await env.EXTRACTION_QUEUE.sendBatch(deliveries.map((body) => ({ body })));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "queue_dispatch_failed",
        candidate_ids: deliveries.map((item) => item.candidate_id),
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
    throw new ApiError(503, "Extraction queue unavailable; retry the request");
  }
}
