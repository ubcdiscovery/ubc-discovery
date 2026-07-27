import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

test("shows a retryable error when the Discover feed cannot load", async ({
  page,
}) => {
  await mockApi(page);
  let attempts = 0;
  await page.route("http://api.test/events?**", (route) => {
    attempts += 1;
    return route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        attempts === 1
          ? { detail: "Service unavailable" }
          : { events: [mockEvent], total: 1 }
      ),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Events are taking a break." })
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: mockEvent.title })
  ).toBeVisible();
});

test("shows a dedicated state when an event no longer exists", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("http://api.test/events/deleted-event", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Event not found" }),
    })
  );

  await page.goto("/events/deleted-event");

  await expect(
    page.getByRole("heading", { name: "This event is no longer available." })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse current events" })
  ).toHaveAttribute("href", "/");
});
