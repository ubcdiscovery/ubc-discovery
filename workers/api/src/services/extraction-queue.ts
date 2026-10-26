import type { ApiEnv } from "../env";
import { integerSetting } from "../env";
import type { EventListingCandidate } from "../db/schema";
import type { Delivery } from "../schemas/candidates";
export function captureTimedOut(candidate: EventListingCandidate, now: Date, env: ApiEnv): boolean {
  return (
    now.getTime() - candidate.createdAt.getTime() >=
    integerSetting(env.EXTRACTION_IMAGE_WAIT_SECONDS, 300) * 1000
  );
}
export async function dispatchCandidates(
  env: ApiEnv,
  candidates: Delivery[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.EXTRACTION_QUEUE_PRODUCER_URL || !env.EXTRACTION_QUEUE_PRODUCER_SECRET) return false;
  const response = await fetcher(env.EXTRACTION_QUEUE_PRODUCER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.EXTRACTION_QUEUE_PRODUCER_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ candidates }),
    signal: AbortSignal.timeout(15_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error("Queue dispatch failed");
  return true;
}
