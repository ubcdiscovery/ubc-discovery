import { t, type Static } from "elysia";
import { ApiError } from "../http/errors";
import type { Event, EventVibe, SourceLabel } from "../db/schema";
export const VIBES = [
  "social",
  "career",
  "academic",
  "arts",
  "culture",
  "outdoors",
  "sports",
  "food",
  "wellness",
  "volunteering",
] as const;
export const LABELS = ["ubc_official", "ams_club", "campus_community"] as const;
export const vibeSchema = t.Union(VIBES.map((v) => t.Literal(v)));
export const sourceLabelSchema = t.Union(LABELS.map((v) => t.Literal(v)));
export const dateSchema = t.Union([t.String(), t.Number()]);
export const nullableDate = t.Nullable(dateSchema);
export const createEventSchema = t.Object(
  {
    title: t.String(),
    description: t.Optional(t.String({ default: "" })),
    source: t.Optional(t.String({ minLength: 1, maxLength: 50, default: "manual" })),
    source_label: t.Optional(sourceLabelSchema),
    source_url: t.Optional(t.Nullable(t.String())),
    club_name: t.Optional(t.Nullable(t.String())),
    vibes: t.Optional(t.Array(vibeSchema)),
    location_name: t.String({ minLength: 1 }),
    event_date: dateSchema,
    event_end_date: t.Optional(nullableDate),
  },
  { additionalProperties: true },
);
export const updateEventSchema = t.Object(
  {
    title: t.Optional(t.String()),
    description: t.Optional(t.String()),
    source: t.Optional(t.String({ minLength: 1, maxLength: 50 })),
    source_label: t.Optional(sourceLabelSchema),
    source_url: t.Optional(t.Nullable(t.String())),
    club_name: t.Optional(t.Nullable(t.String())),
    vibes: t.Optional(t.Array(vibeSchema)),
    location_name: t.Optional(t.String({ minLength: 1 })),
    event_date: t.Optional(nullableDate),
    event_end_date: t.Optional(nullableDate),
  },
  { additionalProperties: true },
);
export type EventInput = Static<typeof createEventSchema>;
export type EventUpdate = Static<typeof updateEventSchema>;
export function parseDate(
  value: string | number | null | undefined,
  requireTimezone = false,
): Date | null {
  if (value == null) return null;
  // Pydantic accepts Unix seconds (or milliseconds outside its 2e10 threshold)
  // as aware UTC datetimes, in addition to ISO calendar strings.
  if (typeof value === "number" || /^[-+]?\d+(?:\.\d+)?$/.test(value)) {
    const timestamp = Number(value);
    const date = new Date(Math.abs(timestamp) > 20_000_000_000 ? timestamp : timestamp * 1000);
    if (!Number.isFinite(date.getTime())) throw new ApiError(422, "Invalid datetime");
    return date;
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/.exec(
      value,
    );
  if (!match) throw new ApiError(422, "Invalid datetime");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > monthDays[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    Number(match[10] ?? 0) > 23 ||
    Number(match[11] ?? 0) > 59
  ) {
    throw new ApiError(422, "Invalid datetime");
  }
  if (requireTimezone && !match[8] && !match[9])
    throw new ApiError(422, "datetime must include a timezone");
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, second, millisecond);
  const offset = match[9]
    ? (Number(match[10]) * 60 + Number(match[11])) * (match[9] === "-" ? -1 : 1)
    : 0;
  return new Date(wall.getTime() - offset * 60_000);
}
export function checkEndDate(
  start: Date | null,
  end: Date | null,
  detail = "event_end_date must not be before event_date",
) {
  if (start && end && end < start) throw new ApiError(422, detail);
}
export function eventValues(body: EventInput) {
  const eventDate = parseDate(body.event_date);
  const eventEndDate = parseDate(body.event_end_date);
  if (!eventDate) throw new ApiError(422, "event_date is required");
  const location = body.location_name.trim();
  if (!location) throw new ApiError(422, "location_name must contain location text");
  checkEndDate(eventDate, eventEndDate);
  return {
    title: body.title,
    description: body.description ?? "",
    source: body.source ?? "manual",
    sourceLabel: (body.source_label ?? "campus_community") as SourceLabel,
    sourceUrl: body.source_url ?? null,
    clubName: body.club_name ?? null,
    vibes: (body.vibes ?? []) as EventVibe[],
    locationName: location,
    eventDate,
    eventEndDate,
  };
}
export function eventChanges(body: EventUpdate): Partial<Event> {
  const changes: Partial<Event> = {};
  if (body.title !== undefined) changes.title = body.title;
  if (body.description !== undefined) changes.description = body.description;
  if (body.source !== undefined) changes.source = body.source;
  if (body.source_label !== undefined) changes.sourceLabel = body.source_label;
  if (body.source_url !== undefined) changes.sourceUrl = body.source_url;
  if (body.club_name !== undefined) changes.clubName = body.club_name;
  if (body.vibes !== undefined) changes.vibes = body.vibes;
  if (body.location_name !== undefined) {
    const value = body.location_name.trim();
    if (!value) throw new ApiError(422, "location_name must contain location text");
    changes.locationName = value;
  }
  if (body.event_date !== undefined) {
    const date = parseDate(body.event_date);
    if (!date) throw new ApiError(422, "event_date must not be null");
    changes.eventDate = date;
  }
  if (body.event_end_date !== undefined) changes.eventEndDate = parseDate(body.event_end_date);
  return changes;
}
