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
import {
  checkEndDate,
  eventChanges,
  eventValues,
  type EventInput,
  type EventUpdate,
} from "../schemas/events";
import { EMBEDDING_MODEL_ID, isValidEmbedding } from "./embeddings";
import { hostsForEvent, normalizeHandles, setEventHosts, type HostSummary } from "./hosts";
export type Database = Db | DbTransaction;
export function eventSnapshot(event: Event, hosts: readonly HostSummary[]) {
  return {
    title: event.title,
    description: event.description,
    source: event.source,
    source_label: event.sourceLabel,
    source_url: event.sourceUrl,
    hosts: hosts.map((host) => host.handle),
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
  event: Pick<Event, "title" | "description" | "locationName">,
  hosts: readonly HostSummary[],
  services: RequestServices,
) {
  const embedding = await services.embedEvent({
    title: event.title,
    description: event.description,
    host_names: hosts.map((host) => host.name),
    location_name: event.locationName,
  });
  return isValidEmbedding(embedding)
    ? { embeddingVector: embedding, embeddingModel: EMBEDDING_MODEL_ID }
    : null;
}
export async function createCanonicalEvent(
  db: Database,
  body: EventInput,
  actor: AuditActor,
  services: RequestServices,
  explicitId?: string,
) {
  const values = eventValues(body);
  const handles = normalizeHandles(body.hosts ?? [], true);
  const id = explicitId ?? (await allocateEventId(db));
  const [event] = await db
    .insert(events)
    .values({ id, ...values, createdAt: services.now() })
    .returning();
  await setEventHosts(db, id, handles);
  const hosts = await hostsForEvent(db, id);
  const embedding = await embeddingFor(event!, hosts, services);
  if (embedding) {
    await db.update(events).set(embedding).where(eq(events.id, id));
    Object.assign(event!, embedding);
  }
  await addEventAudit(
    db,
    event!,
    actor,
    "create",
    null,
    eventSnapshot(event!, hosts),
    services.now(),
  );
  return { event: event!, hosts };
}
export function postgresErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    if ("code" in error && typeof error.code === "string") return error.code;
    if ("cause" in error) return postgresErrorCode(error.cause);
  }
  return undefined;
}

/** Apply an admin update, re-embedding when the embedded text or Hosts change. */
export async function updateCanonicalEvent(
  db: Database,
  event: Event,
  body: EventUpdate,
  actor: AuditActor,
  services: RequestServices,
) {
  const hosts = await hostsForEvent(db, event.id);
  const before = eventSnapshot(event, hosts);
  const changes = eventChanges(body);
  checkEndDate(
    changes.eventDate ?? event.eventDate,
    changes.eventEndDate === undefined ? event.eventEndDate : changes.eventEndDate,
  );
  let savedHosts = hosts;
  if (body.hosts !== undefined) {
    const handles = normalizeHandles(body.hosts, true);
    if (JSON.stringify(handles) !== JSON.stringify(hosts.map((host) => host.handle))) {
      await setEventHosts(db, event.id, handles);
      savedHosts = await hostsForEvent(db, event.id);
    }
  }
  const hostsChanged = savedHosts !== hosts;
  const updated = { ...event, ...changes };
  const embeddingFields = [
    "title",
    "description",
    "vibes",
    "locationName",
    "eventDate",
    "eventEndDate",
  ] as const;
  const embeddingChanged =
    hostsChanged ||
    embeddingFields.some(
      (field) =>
        field in changes && JSON.stringify(event[field]) !== JSON.stringify(updated[field]),
    );
  if (embeddingChanged) {
    const embedding = await embeddingFor(updated, savedHosts, services);
    if (embedding) Object.assign(changes, embedding);
  }
  if (Object.keys(changes).length || hostsChanged) {
    const [saved] = Object.keys(changes).length
      ? await db.update(events).set(changes).where(eq(events.id, event.id)).returning()
      : [event];
    await addEventAudit(
      db,
      saved!,
      actor,
      "update",
      before,
      eventSnapshot(saved!, savedHosts),
      services.now(),
    );
    return [saved!, savedHosts] as const;
  }
  return [event, hosts] as const;
}
