import type { ExtractionMessage, Extraction, EvidenceBatch } from "./types";

export function deliveries(value: unknown): ExtractionMessage[] {
  if (!value || typeof value !== "object" || !("candidates" in value)) {
    throw new Error("candidates required");
  }
  const candidates = value.candidates;
  if (
    !Array.isArray(candidates) ||
    candidates.length < 1 ||
    candidates.length > 10 ||
    candidates.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof item.candidate_id !== "string" ||
        !/^[A-Za-z0-9_-]{8}$/.test(item.candidate_id) ||
        !Number.isSafeInteger(item.generation) ||
        item.generation < 1,
    )
  ) {
    throw new Error("expected 1–10 candidate IDs with generation");
  }
  return [
    ...new Map(
      candidates.map((item) => [
        identity(item),
        { candidate_id: item.candidate_id, generation: item.generation },
      ]),
    ).values(),
  ];
}

export function identity(item: ExtractionMessage): string {
  return `${item.candidate_id}:${item.generation}`;
}

export function validDatetime(value: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
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

export function validExtraction(value: unknown, evidence: EvidenceBatch): value is Extraction {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const keys = [
    "candidate_id",
    "is_event",
    "title",
    "event_date",
    "event_end_date",
    "location_name",
    "club_name",
    "vibes",
  ];
  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !(key in result)) ||
    typeof result.candidate_id !== "string" ||
    typeof result.is_event !== "boolean"
  )
    return false;
  for (const [key, limit] of [
    ["title", 500],
    ["location_name", 255],
    ["club_name", 255],
  ] as const) {
    const field = result[key];
    if (field !== null && (typeof field !== "string" || Array.from(field).length > limit))
      return false;
  }
  for (const key of ["event_date", "event_end_date"] as const) {
    const field = result[key];
    if (field !== null && (typeof field !== "string" || !validDatetime(field))) return false;
  }
  // The API supplies its authoritative taxonomy; the Worker does not copy it.
  const schema = evidence.schema as {
    properties?: {
      extractions?: { items?: { properties?: { vibes?: { items?: { enum?: unknown[] } } } } };
    };
  };
  const allowed = schema.properties?.extractions?.items?.properties?.vibes?.items?.enum;
  return (
    Array.isArray(allowed) &&
    Array.isArray(result.vibes) &&
    result.vibes.every((vibe) => typeof vibe === "string" && allowed.includes(vibe))
  );
}
