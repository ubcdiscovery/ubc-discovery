import type { Event } from "../db/schema";
import type { Database } from "../services/event-administration";
import { hostsForEvents, type HostSummary } from "../services/hosts";
import type { ObjectStorage } from "../services/storage";

export type PublicEventRow = Omit<Event, "embeddingVector" | "embeddingModel">;
export function eventImageKey(id: string): string {
  return `event-pictures/${id}.webp`;
}

export function presentEvent(event: PublicEventRow, hosts: HostSummary[], storage: ObjectStorage) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    source: event.source,
    source_label: event.sourceLabel,
    source_url: event.sourceUrl,
    hosts,
    event_picture_url: storage.publicUrl(eventImageKey(event.id)),
    vibes: event.vibes,
    location_name: event.locationName,
    event_date: event.eventDate?.toISOString() ?? null,
    event_end_date: event.eventEndDate?.toISOString() ?? null,
    created_at: event.createdAt.toISOString(),
  };
}

export type EventResponse = ReturnType<typeof presentEvent>;

/** Pair each row with its Hosts, loaded in one query. */
export async function withHosts<Row extends { id: string }>(
  db: Database,
  rows: Row[],
): Promise<[Row, HostSummary[]][]> {
  const hosts = await hostsForEvents(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => [row, hosts.get(row.id) ?? []]);
}

export async function presentEvents(db: Database, rows: PublicEventRow[], storage: ObjectStorage) {
  return (await withHosts(db, rows)).map(([event, hosts]) => presentEvent(event, hosts, storage));
}

export function presentPastEvent(
  event: PublicEventRow,
  hosts: HostSummary[],
  average: number | null,
  count: number,
  storage: ObjectStorage,
) {
  return { ...presentEvent(event, hosts, storage), average_rating: average, rating_count: count };
}

export function presentAdminEvent(
  event: PublicEventRow,
  hosts: HostSummary[],
  storage: ObjectStorage,
) {
  return {
    ...presentEvent(event, hosts, storage),
    is_archived: event.isArchived,
    archived_at: event.archivedAt?.toISOString() ?? null,
    archived_by: event.archivedBy,
  };
}
