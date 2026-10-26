import { eq } from "drizzle-orm";
import { type DbTransaction } from "../../db";
import { eventListingCandidates as candidates, type EventListingCandidate } from "../../db/schema";
import { ApiError } from "../../http/errors";
import { type Delivery, type ExtractionValue } from "../../schemas/candidates";
import { parseDate } from "../../schemas/events";

export function settledStatus(candidate: EventListingCandidate, generation: number) {
  if (candidate.processingGeneration !== generation) return "stale";
  if (candidate.processingError) return "terminal";
  if (candidate.processingCompletedAt || candidate.status !== "pending") return "completed";
  return null;
}
export function uniqueDeliveries(items: Delivery[]) {
  if (
    new Set(items.map((item) => JSON.stringify([item.candidate_id, item.generation]))).size !==
    items.length
  )
    throw new ApiError(422, "deliveries must be unique");
}
export async function lockedCandidate(tx: DbTransaction, id: string) {
  const [candidate] = await tx.select().from(candidates).where(eq(candidates.id, id)).for("update");
  return candidate;
}
export function extractionFields(value: ExtractionValue, model: string, now: Date) {
  const eventDate = parseDate(value.event_date, true);
  const eventEndDate = parseDate(value.event_end_date, true);
  const original = {
    candidate_id: value.candidate_id,
    is_event: value.is_event,
    title: value.title ?? null,
    event_date: eventDate?.toISOString() ?? null,
    event_end_date: eventEndDate?.toISOString() ?? null,
    location_name: value.location_name ?? null,
    club_name: value.club_name ?? null,
    vibes: value.vibes ?? [],
  };
  const base = {
    extractedOriginal: original,
    extractionModel: model,
    extractedAt: now,
    isEvent: value.is_event,
  };
  return value.is_event
    ? {
        ...base,
        title: value.title ?? null,
        eventDate,
        eventEndDate,
        locationName: value.location_name ?? null,
        clubName: value.club_name ?? null,
        vibes: value.vibes ?? [],
        sourceLabel: "ams_club" as const,
      }
    : {
        ...base,
        title: null,
        eventDate: null,
        eventEndDate: null,
        locationName: null,
        clubName: null,
        vibes: [],
        sourceLabel: null,
      };
}
