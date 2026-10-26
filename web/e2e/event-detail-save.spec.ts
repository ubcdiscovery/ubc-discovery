import { expect, test } from "@playwright/test";
import { existingProfile, mockApi, mockEvent, setAuthenticatedUser } from "./support/auth";

test("mobile event detail keeps Save and bottom navigation independently tappable", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "This checks the two persistent mobile bars.");
  await setAuthenticatedUser(page);
  let saves = 0;
  await mockApi(page, { profile: existingProfile, onSave: () => saves++ });
  await page.route("http://api.test/saved-events**", async (route) => {
    if (
      new URL(route.request().url()).pathname === "/saved-events" &&
      route.request().method() === "GET"
    ) {
      const savedEvents = saves ? [{ saved_at: new Date().toISOString(), event: mockEvent }] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ saved_events: savedEvents, total: savedEvents.length }),
      });
    } else {
      await route.fallback();
    }
  });
  await page.goto(`/events/${mockEvent.id}`);

  const save = page
    .getByRole("button", { name: "Save event", exact: true })
    .filter({ visible: true });
  const tabs = page.getByTestId("bottom-tabs");
  await expect(save).toBeVisible();
  await expect(tabs).toBeVisible();
  const saveBounds = await save.boundingBox();
  const tabBounds = await tabs.boundingBox();
  expect(saveBounds).not.toBeNull();
  expect(tabBounds).not.toBeNull();
  expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(tabBounds!.y);

  // An ordinary pointer click must reach Save; force would hide the overlap bug.
  await save.click();
  await expect.poll(() => saves).toBe(1);
  await expect(
    page.getByRole("button", { name: "Remove from saved events" }).filter({ visible: true }),
  ).toBeVisible();
  await tabs.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(page).toHaveURL("/saved");
  await page.getByRole("tab", { name: /past events/i }).click();
  await expect(page.getByRole("heading", { name: mockEvent.title })).toBeVisible();
});

test("mobile event detail Save sends a visitor through the real UI auth boundary", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "This checks the persistent mobile event action.");
  await mockApi(page);
  await page.goto(`/events/${mockEvent.id}`);
  await page
    .getByRole("button", { name: "Save event", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(
    `/sign-in?redirect=${encodeURIComponent(`/events/${mockEvent.id}`)}`,
  );
});
