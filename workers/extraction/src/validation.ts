import type { ExtractionMessage, Extraction, EvidenceBatch } from "./types";

export function identity(item: ExtractionMessage): string {
  return `${item.candidate_id}:${item.generation}`;
}

/** An ISO 8601 datetime; the offset is optional because the API reads local wall-clock time. */
export function validDatetime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(match[7] ? value : `${value}Z`))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    y >= 1 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= days[m - 1] &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second ?? 0) < 60
  );
}

const STRING_LIMITS: Record<string, number> = { title: 500, location_name: 255, club_name: 255 };
const DATETIME_KEYS = new Set(["event_date", "event_end_date"]);

type ResponseSchema = {
  properties?: {
    extractions?: {
      items?: {
        required?: unknown[];
        properties?: Record<string, { type?: unknown }> & {
          vibes?: { items?: { enum?: unknown[] } };
        };
      };
    };
  };
};

export function validExtraction(value: unknown, evidence: EvidenceBatch): value is Extraction {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  // The API supplies the authoritative field list, so either side can change it first.
  const items = (evidence.schema as ResponseSchema).properties?.extractions?.items;
  const keys = items?.required;
  if (
    !Array.isArray(keys) ||
    !keys.every((key): key is string => typeof key === "string") ||
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !(key in result)) ||
    typeof result.candidate_id !== "string" ||
    typeof result.is_event !== "boolean"
  )
    return false;
  for (const key of keys) {
    const field = result[key];
    if (items?.properties?.[key]?.type === "boolean" && typeof field !== "boolean") return false;
    if (key in STRING_LIMITS) {
      if (
        field !== null &&
        (typeof field !== "string" || Array.from(field).length > STRING_LIMITS[key]!)
      )
        return false;
    }
    if (
      DATETIME_KEYS.has(key) &&
      field !== null &&
      (typeof field !== "string" || !validDatetime(field))
    )
      return false;
  }
  // The API supplies its authoritative taxonomy; the Worker does not copy it.
  const allowed = items?.properties?.vibes?.items?.enum;
  return (
    Array.isArray(allowed) &&
    Array.isArray(result.vibes) &&
    result.vibes.every((vibe) => typeof vibe === "string" && allowed.includes(vibe))
  );
}
