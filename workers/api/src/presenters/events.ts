import type { Event } from '../db/schema';
import type { ObjectStorage } from '../services/storage';

export type PublicEventRow = Omit<Event, 'embeddingVector'>;
export function eventImageKey(id: string): string { return `event-pictures/${id}.webp`; }

export function presentEvent(event: PublicEventRow, storage: ObjectStorage) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    source: event.source,
    source_label: event.sourceLabel,
    source_url: event.sourceUrl,
    club_name: event.clubName,
    event_picture_url: storage.publicUrl(eventImageKey(event.id)),
    vibes: event.vibes,
    location_name: event.locationName,
    event_date: event.eventDate?.toISOString() ?? null,
    event_end_date: event.eventEndDate?.toISOString() ?? null,
    created_at: event.createdAt.toISOString(),
  };
}

export type EventResponse = ReturnType<typeof presentEvent>;

export function presentPastEvent(event: PublicEventRow, average: number | null, count: number, storage: ObjectStorage) {
  return { ...presentEvent(event, storage), average_rating: average, rating_count: count };
}

export function presentAdminEvent(event: PublicEventRow, storage: ObjectStorage) {
  return {
    ...presentEvent(event, storage), is_archived: event.isArchived,
    archived_at: event.archivedAt?.toISOString() ?? null, archived_by: event.archivedBy,
  };
}
