import { expect, test } from "@playwright/test";
import { existingProfile, mockApi, mockEvent, setAuthenticatedUser } from "./support/auth";

const longTitle =
  "Community climate workshop and garden supper on the Main Mall";

function inDays(days: number, hour = 17) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Six events: today, tomorrow, inside the week, then further out. */
function feed() {
  const offsets = [0, 1, 3, 12, 20, 30];
  return Array.from({ length: 6 }, (_, i) => ({
    ...mockEvent,
    id: `event-${i + 1}`,
    title: i === 0 ? longTitle : `Campus event ${i + 1}`,
    club_name: `Club ${i + 1}`,
    location_name: "Nest Room 2301",
    event_picture_url: null,
    vibes: ["social", "food", "outdoors"],
    event_date: inDays(offsets[i]),
    event_end_date: null,
  }));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page, { profile: existingProfile });
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: feed(), total: 6 }),
    })
  );
});

test("shows each title and time once, with a comfortable save target", async ({
  page,
}) => {
  await page.goto("/");

  const card = page
    .getByRole("region", { name: "Upcoming events" })
    .locator('article[role="link"]')
    .first();

  await expect(card.getByRole("heading", { name: longTitle })).toHaveCount(1);
  await expect(card.getByText(/\d{1,2}:\d{2} (AM|PM)/)).toHaveCount(1);
  await expect(card.getByText(/UBC DISCOVERY/i)).toHaveCount(0);
  await expect(card.getByText("Nest Room 2301")).toBeVisible();

  const save = card.getByRole("button", { name: "Save event" });
  const box = await save.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("labels dates relative to now", async ({ page }) => {
  await page.goto("/");
  const feedRegion = page.getByRole("region", { name: "Upcoming events" });

  await expect(feedRegion.getByText(/^TODAY · /)).toBeVisible();
  await expect(feedRegion.getByText(/^TOMORROW · /)).toBeVisible();
  // Day 3 is inside the week, so it reads as a weekday rather than a date.
  await expect(
    feedRegion.getByText(/^(MON|TUE|WED|THU|FRI|SAT|SUN) · /)
  ).toHaveCount(1);
});

test("opens an event by click and by keyboard", async ({ page }) => {
  await page.goto("/");
  const cards = page.locator('article[role="link"]');

  await cards.first().click();
  await expect(page).toHaveURL("/events/event-1");

  await page.goBack();
  await cards.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/events/event-2");
});

test("caps tags at two and keeps every card bottom aligned", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('article[role="link"]').first();

  // Three vibes in the data, two shown, one folded into the overflow chip.
  await expect(card.getByText(/^\[/)).toHaveCount(2);
  await expect(card.getByText("+1", { exact: true })).toBeVisible();

  const mismatched = await page.evaluate(() => {
    const rows = new Map<number, Set<number>>();
    for (const el of document.querySelectorAll('article[role="link"]')) {
      const box = el.getBoundingClientRect();
      const top = Math.round(box.top);
      if (!rows.has(top)) rows.set(top, new Set());
      rows.get(top)!.add(Math.round(box.bottom));
    }
    return [...rows.values()].filter((bottoms) => bottoms.size > 1).length;
  });
  expect(mismatched).toBe(0);
});

test("the save button toggles without opening the event", async ({ page }) => {
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: feed(), total: 6 }),
    })
  );

  // The shared mock always reports an empty shortlist, which would undo the
  // optimistic update on refetch. Keep the saved state here instead.
  const saved = new Set<string>();
  await page.route("http://api.test/saved-events**", (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/")[2];
    if (route.request().method() === "PUT") {
      saved.add(id);
      return route.fulfill({ status: 201, contentType: "application/json",
        body: JSON.stringify({ event_id: id, saved_at: new Date().toISOString() }) });
    }
    if (route.request().method() === "DELETE") {
      saved.delete(id);
      return route.fulfill({ status: 204, body: "" });
    }
    const items = feed()
      .filter((event) => saved.has(event.id))
      .map((event) => ({ saved_at: new Date().toISOString(), event }));
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ saved_events: items, total: items.length }) });
  });

  await page.goto("/");

  const save = page
    .locator('article[role="link"]')
    .first()
    .getByRole("button", { name: "Save event" });

  await expect(save).toHaveAttribute("aria-pressed", "false");
  await save.click();

  await expect(
    page.getByRole("button", { name: "Remove from saved events" }).first()
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL("/");
});

test("never scrolls sideways on a narrow phone", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This checks the mobile feed.");

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    await expect(page.locator('article[role="link"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      width
    );
  }
});

test("uses the cover image in the header band when there is one", async ({
  page,
}) => {
  const cover = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#e8f542"/></svg>'
  )}`;
  await mockApi(page, { profile: existingProfile });
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        // Identical apart from the cover, so any height gap is the cover's doing.
        events: [
          { ...feed()[1], id: "with-cover", event_picture_url: cover },
          { ...feed()[1], id: "no-cover", event_picture_url: null },
        ],
        total: 2,
      }),
    })
  );
  await page.goto("/");

  const withCover = page.locator('article[role="link"]').first();
  const noCover = page.locator('article[role="link"]').nth(1);

  await expect(withCover.locator("img")).toBeVisible();
  await expect(noCover.locator("img")).toHaveCount(0);

  // The date has to stay readable on top of the artwork.
  await expect(withCover.getByText(/^AUG|^SEP/)).toBeVisible();

  // A cover must not make one card taller than its neighbour.
  const a = await withCover.boundingBox();
  const b = await noCover.boundingBox();
  expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
});
