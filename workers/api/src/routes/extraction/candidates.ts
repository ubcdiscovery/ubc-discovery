import { eq } from "drizzle-orm";
import { type DbTransaction } from "../../db";
import { eventListingCandidates as candidates, type EventListingCandidate } from "../../db/schema";
import { ApiError } from "../../http/errors";
import { type Delivery, type ExtractionValue } from "../../schemas/candidates";
import { parseDate } from "../../schemas/events";
import { vancouverWallTime } from "../../services/candidate-publication";

/**
 * The extractor writes Vancouver wall-clock times without an offset, since UBC posts
 * state local time. An explicit offset, as older prompts asked for, is still honoured.
 */
export function parseExtractedDate(value: string | number | null | undefined): Date | null {
  const date = parseDate(value);
  // Unix timestamps and values with an offset or Z are already absolute.
  if (!date || typeof value !== "string" || !/^\d{4}-/.test(value)) return date;
  if (/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value.slice(10))) return date;
  return vancouverWallTime(date);
}
const weekday = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Vancouver",
  weekday: "long",
});
const wallClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Vancouver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const HALF_YEAR_MS = 183 * 86_400_000;
/**
 * The extractor copies the post's year when the post omits one, so "Jan 15" in a
 * December post comes back as last January. A date more than half a year before
 * the post moves to the following year; nearer past dates stay, so an old post
 * never turns into an upcoming event.
 */
export function rollForwardYear(date: Date | null, postedAt: Date | null): Date | null {
  // Without a known posting time (the initial backfill) the post may be years old,
  // and moving its dates forward would turn past events into upcoming ones.
  if (!date || !postedAt || date.getTime() >= postedAt.getTime() - HALF_YEAR_MS) return date;
  const [day, time] = wallClock.format(date).split(" ");
  const next = `${Number(day!.slice(0, 4)) + 1}${day!.slice(4)}T${time}`;
  // February 29 has no counterpart next year.
  return next.slice(5, 10) === "02-29" ? date : parseExtractedDate(next);
}
/** A reference time the extractor can resolve relative dates against, e.g. "Friday 2026-10-30 14:05". */
export function vancouverReference(value: Date): string {
  return `${weekday.format(value)} ${wallClock.format(value)}`;
}

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
export function extractionFields(
  value: ExtractionValue,
  model: string,
  now: Date,
  postedAt: Date | null,
) {
  const eventDate = rollForwardYear(parseExtractedDate(value.event_date), postedAt);
  const eventEndDate = rollForwardYear(parseExtractedDate(value.event_end_date), postedAt);
  const original = {
    candidate_id: value.candidate_id,
    is_event: value.is_event,
    title: value.title ?? null,
    event_date: eventDate?.toISOString() ?? null,
    event_end_date: eventEndDate?.toISOString() ?? null,
    location_name: value.location_name ?? null,
    is_repost: value.is_repost ?? false,
    vibes: value.vibes ?? [],
  };
  const base = {
    extractedOriginal: original,
    extractionModel: model,
    extractedAt: now,
    isEvent: value.is_event,
    isRepost: value.is_event && (value.is_repost ?? false),
  };
  return value.is_event
    ? {
        ...base,
        title: value.title ?? null,
        eventDate,
        eventEndDate,
        locationName: value.location_name ?? null,
        vibes: value.vibes ?? [],
        sourceLabel: "ams_club" as const,
      }
    : {
        ...base,
        title: null,
        eventDate: null,
        eventEndDate: null,
        locationName: null,
        vibes: [],
        sourceLabel: null,
      };
}
