import type { ApiEvent, CreateEventInput, UpdateEventInput } from "~/lib/api";

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

export function emptyAdminEventDraft(): AdminEventDraft {
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1_000);
  return {
    title: "",
    description: "",
    clubName: "",
    locationName: "",
    eventDate: toLocalDateTime(start.toISOString()),
    eventEndDate: toLocalDateTime(end.toISOString()),
    sourceLabel: "campus_community",
    sourceUrl: "",
    externalCtaLabel: "",
    vibes: [],
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

export function createInputFromDraft(draft: AdminEventDraft): CreateEventInput {
  return updateInputFromDraft(draft) as CreateEventInput;
}

export type AuditFieldChange = {
  field: string;
  from: string;
  to: string;
};

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.length ? value.join(", ") : "—";
  }
  return JSON.stringify(value);
}

export function auditFieldChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): AuditFieldChange[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.flatMap((field) => {
    const fromValue = before?.[field];
    const toValue = after?.[field];
    if (JSON.stringify(fromValue) === JSON.stringify(toValue)) return [];
    return [
      {
        field: field.replaceAll("_", " "),
        from: formatAuditValue(fromValue),
        to: formatAuditValue(toValue),
      },
    ];
  });
}
