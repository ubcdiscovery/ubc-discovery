import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import {
  candidateHosts,
  eventHosts,
  events,
  eventListingCandidates as candidates,
  type EventListingCandidate,
} from "../db/schema";
import { ApiError } from "../http/errors";
import type { AuditActor } from "../http/auth";
import { eventImageKey } from "../presenters/events";
import { createCanonicalEvent, type Database } from "./event-administration";
import type { RequestServices } from "./index";
import { candidateHostHandles } from "./hosts";

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function vancouverDay(value: Date): string {
  const parts = localFormatter.formatToParts(value);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function localMidnightUtc(day: string): Date {
  const wall = new Date(`${day}T00:00:00Z`).getTime();
  let result = wall;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    timeZoneName: "longOffset",
  });
  for (let step = 0; step < 3; step++) {
    const offset = formatter
      .formatToParts(new Date(result))
      .find((item) => item.type === "timeZoneName")!.value;
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
    const minutes = match
      ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "-" ? -1 : 1)
      : 0;
    result = wall - minutes * 60_000;
  }
  return new Date(result);
}
export function localDayBounds(value: Date): [Date, Date] {
  const day = vancouverDay(value);
  const next = new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return [localMidnightUtc(day), localMidnightUtc(next)];
}
export function isComplete(candidate: EventListingCandidate): boolean {
  return (
    candidate.isEvent === true &&
    !!candidate.title?.trim() &&
    candidate.eventDate !== null &&
    !!candidate.locationName?.trim()
  );
}
/** Pending Candidates and live Event Listings sharing a Host with the Candidate on its day. */
export async function sameHostSameDay(candidate: EventListingCandidate, db: Database) {
  const handles = await candidateHostHandles(db, candidate.id);
  if (!handles.length || !candidate.eventDate) return { candidates: [], events: [] };
  const [start, end] = localDayBounds(candidate.eventDate);
  const candidateMatches = await db
    .select()
    .from(candidates)
    .where(
      and(
        eq(candidates.status, "pending"),
        ne(candidates.id, candidate.id),
        inArray(
          candidates.id,
          db
            .select({ id: candidateHosts.candidateId })
            .from(candidateHosts)
            .where(inArray(candidateHosts.hostHandle, handles)),
        ),
        gte(candidates.eventDate, start),
        lt(candidates.eventDate, end),
      ),
    )
    .orderBy(candidates.eventDate, candidates.id);
  const eventMatches = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.isArchived, false),
        ne(events.id, candidate.id),
        inArray(
          events.id,
          db
            .select({ id: eventHosts.eventId })
            .from(eventHosts)
            .where(inArray(eventHosts.hostHandle, handles)),
        ),
        gte(events.eventDate, start),
        lt(events.eventDate, end),
      ),
    )
    .orderBy(events.eventDate, events.id);
  return { candidates: candidateMatches, events: eventMatches };
}
export async function previewAutoPublication(
  db: Database,
  candidate: EventListingCandidate,
  now: Date,
): Promise<"published" | "pending"> {
  if (
    candidate.status !== "pending" ||
    !isComplete(candidate) ||
    candidate.isRepost ||
    candidate.sourceLabel !== "ams_club" ||
    candidate.eventDate! < now
  )
    return "pending";
  const matches = await sameHostSameDay(candidate, db);
  if (matches.candidates.length || matches.events.length) return "pending";
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, candidate.id))
    .limit(1);
  return event ? "pending" : "published";
}
export async function publishCandidate(
  db: Database,
  candidate: EventListingCandidate,
  actor: AuditActor,
  services: RequestServices,
) {
  if (
    candidate.title === null ||
    candidate.eventDate === null ||
    candidate.locationName === null ||
    candidate.sourceLabel === null
  ) {
    throw new ApiError(422, "Candidate is missing required Event Listing fields");
  }
  await createCanonicalEvent(
    db,
    {
      title: candidate.title,
      description: candidate.description,
      source: candidate.sourceType,
      source_label: candidate.sourceLabel,
      source_url: candidate.sourceUrl,
      hosts: await candidateHostHandles(db, candidate.id),
      vibes: candidate.vibes ?? [],
      location_name: candidate.locationName,
      event_date: candidate.eventDate.toISOString(),
      event_end_date: candidate.eventEndDate?.toISOString() ?? null,
    },
    actor,
    services,
    candidate.id,
  );
  if (candidate.imageKeys?.length)
    await services.storage.copyObject(candidate.imageKeys[0]!, eventImageKey(candidate.id));
  await db.update(candidates).set({ status: "approved" }).where(eq(candidates.id, candidate.id));
  candidate.status = "approved";
}
export async function processAutoPublication(
  db: Database,
  candidate: EventListingCandidate,
  services: RequestServices,
): Promise<"published" | "pending"> {
  const [locked] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidate.id))
    .for("update");
  if (
    !locked ||
    locked.status !== "pending" ||
    !isComplete(locked) ||
    locked.isRepost ||
    locked.sourceLabel !== "ams_club" ||
    locked.eventDate! < services.now()
  )
    return "pending";
  // Sorted so Candidates sharing several Hosts take the locks in the same order.
  for (const handle of (await candidateHostHandles(db, locked.id)).sort())
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`candidate-auto-publication:${handle}:${vancouverDay(locked.eventDate!)}`}, 0))`,
    );
  if ((await previewAutoPublication(db, locked, services.now())) !== "published") return "pending";
  await publishCandidate(
    db,
    locked,
    { actorType: "system", actorId: "d4ee205e-3e54-587e-8294-b31757177ac1" },
    services,
  );
  return "published";
}
