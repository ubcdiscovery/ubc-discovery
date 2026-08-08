import type { Route } from "@playwright/test";

export type AdminMockEvent = {
  id: string;
  title: string;
  description: string;
  club_name: string | null;
  location_name: string;
  [key: string]: unknown;
};

export function createAdminApiMock(options: {
  events: AdminMockEvent[];
  onList?: (q: string) => void;
  onCreate?: (body: Record<string, unknown>) => void;
  onArchive?: (archived: boolean) => void;
  onUpdate?: (body: Record<string, unknown>) => void;
  onImageUpload?: () => void;
  updateError?: { status: number; detail: string };
}) {
  let events = options.events;
  const auditEntries: Record<string, Array<Record<string, unknown>>> = {};

  function addAudit(eventId: string, action: string) {
    auditEntries[eventId] ??= [];
    auditEntries[eventId].push({
      id: `${eventId}-${auditEntries[eventId].length + 1}`,
      event_id: eventId,
      actor_type: "member",
      actor_id: "admin-1",
      action,
      before: null,
      after: null,
      created_at: "2026-01-01T00:00:00Z",
    });
  }

  return async function handleAdminApi(route: Route, url: URL) {
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
      const status = url.searchParams.get("status") ?? "all";
      const statusMatches = status === "all"
        ? matches
        : matches.filter((event) => Boolean(event.is_archived) === (status === "archived"));
      const requestedSkip = Number.parseInt(url.searchParams.get("skip") ?? "0", 10);
      const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
      const skip = Number.isFinite(requestedSkip) && requestedSkip >= 0 ? requestedSkip : 0;
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : matches.length;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: statusMatches.slice(skip, skip + limit), total: statusMatches.length }),
      });
      return true;
    }

    if (url.pathname === "/admin/events" && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      options.onCreate?.(body);
      const event = {
        ...events[0],
        ...body,
        id: "created-event",
        is_archived: false,
        archived_at: null,
        archived_by: null,
      };
      events = [...events, event];
      addAudit(event.id, "create");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(event) });
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
      addAudit(eventId, "image_upload");
      await route.fulfill({ status: 204 });
      return true;
    }

    if (!url.pathname.startsWith("/admin/events/")) return false;
    const auditPath = url.pathname.match(/^\/admin\/events\/([^/]+)\/audit$/);
    if (auditPath && route.request().method() === "GET") {
      const eventId = decodeURIComponent(auditPath[1]);
      await route.fulfill({
        status: events.some((candidate) => candidate.id === eventId) ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify({ entries: auditEntries[eventId] ?? [] }),
      });
      return true;
    }
    const lifecyclePath = url.pathname.match(/^\/admin\/events\/([^/]+)\/(archive|restore)$/);
    if (lifecyclePath && route.request().method() === "POST") {
      const eventId = decodeURIComponent(lifecyclePath[1]);
      const archived = lifecyclePath[2] === "archive";
      const event = events.find((candidate) => candidate.id === eventId);
      if (!event) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Event not found" }) });
        return true;
      }
      options.onArchive?.(archived);
      events = events.map((candidate) => candidate.id === eventId ? { ...candidate, is_archived: archived, archived_at: archived ? "2026-01-01T00:00:00Z" : null } : candidate);
      addAudit(eventId, archived ? "archive" : "restore");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events.find((candidate) => candidate.id === eventId)) });
      return true;
    }
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
      addAudit(eventId, "update");
    }
    await route.fulfill({
      status: updated ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(updated ?? { detail: "Event not found" }),
    });
    return true;
  };
}
