import { expect, test } from "@playwright/test";
import { existingProfile, mockApi, mockEvent, setAuthenticatedUser } from "./support/auth";

test("returns a visitor to Saved after sign-in", async ({ page }) => {
  await mockApi(page, { profile: existingProfile });
  await page.goto("/saved");

  await page.getByRole("link", { name: /sign in to save/i }).click();
  await expect(page).toHaveURL("/sign-in?redirect=%2Fsaved");

  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page).toHaveURL("/saved");
});

test("deep-links tabs, keeps ongoing events upcoming, and removes unsaved events", async ({
  page,
}) => {
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });

  const now = Date.now();
  let savedEvents = [
    {
      saved_at: new Date(now - 3_000).toISOString(),
      event: {
        ...mockEvent,
        id: "future-event",
        title: "Future Event",
        event_date: new Date(now + 2 * 60 * 60 * 1_000).toISOString(),
        event_end_date: new Date(now + 3 * 60 * 60 * 1_000).toISOString(),
      },
    },
    {
      saved_at: new Date(now - 2_000).toISOString(),
      event: {
        ...mockEvent,
        id: "ongoing-event",
        title: "Ongoing Event",
        event_date: new Date(now - 60 * 60 * 1_000).toISOString(),
        event_end_date: new Date(now + 60 * 60 * 1_000).toISOString(),
      },
    },
    {
      saved_at: new Date(now - 1_000).toISOString(),
      event: {
        ...mockEvent,
        id: "past-event",
        title: "Past Event",
        event_date: new Date(now - 3 * 60 * 60 * 1_000).toISOString(),
        event_end_date: new Date(now - 2 * 60 * 60 * 1_000).toISOString(),
      },
    },
  ];
  let removedEventId: string | null = null;

  await page.route("http://api.test/saved-events**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/saved-events" && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          saved_events: savedEvents,
          total: savedEvents.length,
        }),
      });
      return;
    }
    if (method === "DELETE") {
      removedEventId = url.pathname.split("/").at(-1) ?? null;
      savedEvents = savedEvents.filter(({ event }) => event.id !== removedEventId);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  });

  await page.goto("/saved?tab=past");

  await expect(page.getByRole("tab", { name: /past events/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Past Event" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ongoing Event" })).toHaveCount(0);

  await page.getByRole("tab", { name: /coming up/i }).click();
  await expect(page).toHaveURL("/saved?tab=upcoming");
  await expect(page.getByRole("heading", { name: "Future Event" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ongoing Event" })).toBeVisible();

  await page
    .getByRole("link", { name: "View Future Event" })
    .locator("..")
    .getByRole("button", { name: "Remove from saved events" })
    .click();

  await expect.poll(() => removedEventId).toBe("future-event");
  await expect(page.getByRole("heading", { name: "Future Event" })).toHaveCount(0);
});
