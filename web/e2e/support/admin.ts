import type { Route } from "@playwright/test";

export type AdminMockEvent = {
  id: string;
  title: string;
  description: string;
  club_name: string | null;
  location_name: string;
  [key: string]: unknown;
};

export type AdminMockCandidate = {
  id: string;
  title: string;
  description: string;
  club_name: string | null;
  location_name: string | null;
  source_type: string;
  external_source_id: string;
  source_excerpt: string | null;
  image_reference: string | null;
  extraction_confidence: number;
  extraction_metadata: Record<string, unknown>;
  extraction_output: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  ingestion_audits: Array<{
    id: string;
    source_type: string;
    external_source_id: string;
    outcome: "created" | "existing";
    credential_name: string;
    received_at: string;
  }>;
  [key: string]: unknown;
};

export const mockCandidate: AdminMockCandidate = {
  id: "candidate-1",
  title: "Extracted Campus Workshop",
  description: "A workshop found in the source channel.",
  club_name: "Campus Club",
  source_url: "https://example.com/workshop",
  external_cta_label: "Learn more",
  vibes: ["career", "social"],
  location_name: "The Nest",
  event_date: "2026-09-01T18:00:00Z",
  event_end_date: "2026-09-01T20:00:00Z",
  source_type: "instagram",
  external_source_id: "post-123",
  source_excerpt: "Join us at The Nest for a campus workshop.",
  image_reference: "instagram://media/post-123",
  extraction_confidence: 0.91,
  extraction_metadata: { extractor_version: "2026-08-08", model: "test-extractor" },
  extraction_output: { title: "Extracted Campus Workshop", location_name: "The Nest" },
  status: "pending",
  created_at: "2026-08-08T12:00:00Z",
  updated_at: "2026-08-08T12:00:00Z",
  ingestion_audits: [
    {
      id: "receipt-1",
      source_type: "instagram",
      external_source_id: "post-123",
      outcome: "created",
      credential_name: "candidate-ingestion",
      received_at: "2026-08-08T12:00:00Z",
    },
  ],
};

export function createAdminApiMock(options: {
  events: AdminMockEvent[];
  candidates?: AdminMockCandidate[];
  onList?: (q: string) => void;
  onCandidateList?: (filters: { q: string; status: string; sourceType: string }) => void;
  onUpdate?: (body: Record<string, unknown>) => void;
  onImageUpload?: () => void;
  updateError?: { status: number; detail: string };
}) {
  let events = options.events;
  const candidates = options.candidates ?? [];

  return async function handleAdminApi(route: Route, url: URL) {
    if (url.pathname === "/admin/candidates" && route.request().method() === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const candidateStatus = url.searchParams.get("status") ?? "";
      const sourceType = url.searchParams.get("source_type") ?? "";
      options.onCandidateList?.({ q: query, status: candidateStatus, sourceType });
      const normalized = query.toLowerCase();
      const matches = candidates.filter((candidate) => {
        const matchesQuery = !normalized || [candidate.title, candidate.description, candidate.club_name, candidate.source_type, candidate.external_source_id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalized));
        const matchesStatus = !candidateStatus || candidate.status === candidateStatus;
        const matchesSource = !sourceType || candidate.source_type === sourceType;
        return matchesQuery && matchesStatus && matchesSource;
      });
      const requestedSkip = Number.parseInt(url.searchParams.get("skip") ?? "0", 10);
      const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
      const skip = Number.isFinite(requestedSkip) && requestedSkip >= 0 ? requestedSkip : 0;
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : matches.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: matches.slice(skip, skip + limit), total: matches.length }),
      });
      return true;
    }

    if (url.pathname.startsWith("/admin/candidates/") && route.request().method() === "GET") {
      const candidateId = decodeURIComponent(url.pathname.slice("/admin/candidates/".length));
      const candidate = candidates.find((item) => item.id === candidateId);
      await route.fulfill({
        status: candidate ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(candidate ?? { detail: "Candidate not found" }),
      });
      return true;
    }

    if (url.pathname === "/admin/events" && route.request().method() === "GET") {
      const query = url.searchParams.get("q") ?? "";
      options.onList?.(query);
      const normalized = query.toLowerCase();
      const matches = normalized
        ? events.filter((event) =>
            [event.title, event.description, event.club_name, event.location_name]
              .filter(Boolean)
              .some((value) => String(value).toLowerCase().includes(normalized))
          )
        : events;
      const requestedSkip = Number.parseInt(url.searchParams.get("skip") ?? "0", 10);
      const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
      const skip = Number.isFinite(requestedSkip) && requestedSkip >= 0 ? requestedSkip : 0;
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : matches.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: matches.slice(skip, skip + limit), total: matches.length }),
      });
      return true;
    }

    const presignedPath = url.pathname.match(/^\/admin\/events\/([^/]+)\/presigned-upload$/);
    if (presignedPath && route.request().method() === "POST") {
      const eventId = decodeURIComponent(presignedPath[1]);
      const event = events.find((candidate) => candidate.id === eventId);
      await route.fulfill({
        status: event ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(
          event
            ? {
                upload_url: `http://api.test/admin/event-image-upload/${encodeURIComponent(eventId)}`,
                fields: {
                  key: `event-pictures/${eventId}.webp`,
                  "Content-Type": "image/webp",
                },
                file_key: `event-pictures/${eventId}.webp`,
                max_file_size_bytes: 3 * 1024 * 1024,
              }
            : { detail: "Event not found" }
        ),
      });
      return true;
    }

    const imageUploadPath = url.pathname.match(/^\/admin\/event-image-upload\/([^/]+)$/);
    if (imageUploadPath && route.request().method() === "POST") {
      const eventId = decodeURIComponent(imageUploadPath[1]);
      options.onImageUpload?.();
      events = events.map((candidate) =>
        candidate.id === eventId
          ? { ...candidate, event_picture_url: `http://images.test/${eventId}.webp` }
          : candidate
      );
      await route.fulfill({ status: 204 });
      return true;
    }

    if (!url.pathname.startsWith("/admin/events/")) return false;
    const eventId = decodeURIComponent(url.pathname.slice("/admin/events/".length));
    const event = events.find((candidate) => candidate.id === eventId);
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: event ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(event ?? { detail: "Event not found" }),
      });
      return true;
    }
    if (route.request().method() !== "PUT") return false;

    const body = route.request().postDataJSON();
    options.onUpdate?.(body);
    if (options.updateError) {
      await route.fulfill({
        status: options.updateError.status,
        contentType: "application/json",
        body: JSON.stringify({ detail: options.updateError.detail }),
      });
      return true;
    }
    const updated = event ? { ...event, ...body } : null;
    if (updated) {
      events = events.map((candidate) => candidate.id === eventId ? updated : candidate);
    }
    await route.fulfill({
      status: updated ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(updated ?? { detail: "Event not found" }),
    });
    return true;
  };
}
