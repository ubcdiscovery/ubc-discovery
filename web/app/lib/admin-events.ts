import type { ApiEvent, UpdateEventInput } from "~/lib/api";

export type AdminEventDraft = {
  title: string;
  description: string;
  clubName: string;
  locationName: string;
  eventDate: string;
  eventEndDate: string;
  sourceLabel: string;
  sourceUrl: string;
  externalCtaLabel: string;
  vibes: string[];
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function draftFromEvent(event: ApiEvent): AdminEventDraft {
  return {
    title: event.title,
    description: event.description,
    clubName: event.club_name ?? "",
    locationName: event.location_name,
    eventDate: toLocalDateTime(event.event_date),
    eventEndDate: toLocalDateTime(event.event_end_date),
    sourceLabel: event.source_label,
    sourceUrl: event.source_url ?? "",
    externalCtaLabel: event.external_cta_label ?? "",
    vibes: event.vibes,
  };
}

export function validateAdminEventDraft(draft: AdminEventDraft): string | null {
  if (!draft.title.trim()) return "Add an Event Listing title.";
  if (!draft.locationName.trim()) return "Add location text.";
  if (!draft.eventDate) return "Add a start date and time.";
  if (
    draft.eventEndDate &&
    new Date(draft.eventEndDate).getTime() < new Date(draft.eventDate).getTime()
  ) {
    return "End date and time must be after the start.";
  }
  return null;
}

export function updateInputFromDraft(draft: AdminEventDraft): UpdateEventInput {
  return {
    title: draft.title.trim(),
    description: draft.description,
    club_name: draft.clubName.trim() || null,
    location_name: draft.locationName.trim(),
    event_date: new Date(draft.eventDate).toISOString(),
    event_end_date: draft.eventEndDate
      ? new Date(draft.eventEndDate).toISOString()
      : null,
    source_label: draft.sourceLabel,
    source_url: draft.sourceUrl.trim() || null,
    external_cta_label: draft.externalCtaLabel.trim() || null,
    vibes: draft.vibes,
  };
}
