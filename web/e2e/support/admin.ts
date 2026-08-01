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
  onUpdate?: (body: Record<string, unknown>) => void;
  updateError?: { status: number; detail: string };
}) {
  let events = options.events;

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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: matches, total: matches.length }),
      });
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
