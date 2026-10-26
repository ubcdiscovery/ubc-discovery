import { eq, sql } from "drizzle-orm";
import type { Db, DbTransaction } from "../db";
import {
  events,
  eventAuditLogs,
  eventListingCandidates,
  createShortId,
  type Event,
} from "../db/schema";
import type { AuditActor } from "../http/auth";
import { ApiError } from "../http/errors";
import type { RequestServices } from "./index";
import { eventValues, type EventInput } from "../schemas/events";
import { isValidEmbedding } from "./embeddings";
export type Database = Db | DbTransaction;
export function eventSnapshot(event: Event) {
  return {
    title: event.title,
    description: event.description,
    source: event.source,
    source_label: event.sourceLabel,
    source_url: event.sourceUrl,
    club_name: event.clubName,
    vibes: event.vibes ?? [],
    location_name: event.locationName,
    event_date: event.eventDate?.toISOString() ?? null,
    event_end_date: event.eventEndDate?.toISOString() ?? null,
    is_archived: event.isArchived,
    archived_at: event.archivedAt?.toISOString() ?? null,
    archived_by: event.archivedBy,
  };
}
export async function allocateEventId(db: Database) {
  await db.execute(sql`SELECT pg_advisory_xact_lock(70000070)`);
  for (let attempts = 0; attempts < 100; attempts++) {
    const id = createShortId();
    const [candidate] = await db
      .select({ id: eventListingCandidates.id })
      .from(eventListingCandidates)
      .where(eq(eventListingCandidates.id, id))
      .limit(1);
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, id))
      .limit(1);
    if (!candidate && !event) return id;
  }
  throw new ApiError(409, "Could not allocate a unique Event Listing id");
}
export async function addEventAudit(
  db: Database,
  event: Event,
  actor: AuditActor,
  action: (typeof eventAuditLogs.$inferInsert)["action"],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  now: Date,
) {
  await db
    .insert(eventAuditLogs)
    .values({ eventId: event.id, ...actor, action, before, after, createdAt: now });
}
export async function embeddingFor(
  event: Pick<Event, "title" | "description" | "clubName" | "locationName">,
  services: RequestServices,
) {
  const embedding = await services.embedEvent({
    title: event.title,
    description: event.description,
    club_name: event.clubName,
    location_name: event.locationName,
  });
  return isValidEmbedding(embedding) ? embedding : null;
}
export async function createCanonicalEvent(
  db: Database,
  body: EventInput,
  actor: AuditActor,
  services: RequestServices,
  explicitId?: string,
) {
  const values = eventValues(body);
  const id = explicitId ?? (await allocateEventId(db));
  const [event] = await db
    .insert(events)
    .values({ id, ...values, createdAt: services.now() })
    .returning();
  const embedding = await embeddingFor(event!, services);
  if (embedding) {
    await db.update(events).set({ embeddingVector: embedding }).where(eq(events.id, id));
    event!.embeddingVector = embedding;
  }
  await addEventAudit(db, event!, actor, "create", null, eventSnapshot(event!), services.now());
  return event!;
}
export function postgresErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string") return error.code;
    if ("cause" in error) return postgresErrorCode(error.cause);
  }
  return undefined;
}
