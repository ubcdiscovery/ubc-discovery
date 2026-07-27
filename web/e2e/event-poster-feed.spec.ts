import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

const longTitle =
  "Community climate workshop and garden supper on the Main Mall";
const posterDataUrl = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <rect width="400" height="400" fill="#1e40ff" />
  </svg>
`)}`;

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: Array.from({ length: 6 }, (_, index) => ({
          ...mockEvent,
          id: `event-${index + 1}`,
          title: index === 0 ? longTitle : `Campus event ${index + 1}`,
          event_picture_url: posterDataUrl,
          vibes: ["social", "food", "outdoors"],
        })),
        total: 6,
      }),
    })
  );
});

test("renders a semantic poster-led Event Listing with a comfortable save target", async ({
  page,
}) => {
  await page.goto("/");

  const listing = page
    .getByRole("region", { name: "Upcoming events" })
    .locator("article")
    .first();
  const listingLink = listing.getByRole("link", {
    name: new RegExp(longTitle),
  });
  await expect(listingLink).toHaveAttribute("href", "/events/event-1");
  await expect(listingLink.getByRole("heading", { name: longTitle })).toBeVisible();
  await expect(listingLink.getByText(/^↳ Main Mall$/)).toBeVisible();
  await expect(listingLink.getByText("[SOCIAL]", { exact: true })).toBeVisible();
  await expect(listing.locator("img").last()).toBeVisible();

  const save = listing.getByRole("button", { name: "Save event" });
  const saveBox = await save.boundingBox();
  expect(saveBox).not.toBeNull();
  expect(saveBox!.width).toBeGreaterThanOrEqual(44);
  expect(saveBox!.height).toBeGreaterThanOrEqual(44);
});

test("uses an unboxed, full-width poster feed at 320 and 390 pixels", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "This checks the mobile Event Listing feed.");

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");

    const article = page
      .getByRole("region", { name: "Upcoming events" })
      .locator("article")
      .first();
    const heading = article.getByRole("heading", { name: longTitle });
    const poster = article.locator("img").last();
    const articleBox = await article.boundingBox();
    const headingBox = await heading.boundingBox();
    const posterBox = await poster.boundingBox();
    expect(articleBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(posterBox).not.toBeNull();

    expect(headingBox!.width / articleBox!.width).toBeGreaterThan(0.8);
    expect(headingBox!.x).toBeCloseTo(articleBox!.x, 0);
    expect(posterBox!.width / articleBox!.width).toBeGreaterThan(0.95);
    expect(posterBox!.y).toBeLessThan(headingBox!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
    await expect(poster).toBeVisible();
  }
});

test("uses a large poster above the event details on desktop", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "This checks the desktop poster wall.");
  await page.goto("/");

  const article = page
    .getByRole("region", { name: "Upcoming events" })
    .locator("article")
    .first();
  const headingBox = await article
    .getByRole("heading", { name: longTitle })
    .boundingBox();
  const articleBox = await article.boundingBox();
  const poster = article.locator("img").last();
  const posterBox = await poster.boundingBox();

  expect(articleBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(posterBox).not.toBeNull();
  expect(posterBox!.width / articleBox!.width).toBeGreaterThan(0.95);
  expect(posterBox!.y).toBeLessThan(headingBox!.y);
  await expect(poster).toBeVisible();
});

test("keeps posters centered and bounded in a wall of at most three columns", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Custom responsive matrix runs once in the desktop project.");

  const matrix = [
    { width: 640, columns: 1, maxPosterWidth: 401 },
    { width: 768, columns: 1, maxPosterWidth: 317 },
    { width: 1024, columns: 2, maxPosterWidth: 317 },
    { width: 1280, columns: 3, maxPosterWidth: 317 },
    { width: 1536, columns: 3, maxPosterWidth: 317 },
  ];

  for (const { width, columns, maxPosterWidth } of matrix) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const feed = page.getByRole("region", { name: "Upcoming events" });
    await expect(feed.locator("article")).toHaveCount(6);
    const articleBoxes = await feed.locator("article").evaluateAll((articles) =>
      articles.map((article) => {
        const box = article.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      })
    );
    const firstPoster = feed.locator("article").first().locator("img").last();
    const gridColumns = await feed.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length
    );
    const feedBox = await feed.boundingBox();
    const posterBox = await firstPoster.boundingBox();
    const firstRow = articleBoxes.filter(
      (box) => Math.abs(box.y - articleBoxes[0].y) < 1
    );
    const rowLeft = firstRow[0].x;
    const rowRight = firstRow[firstRow.length - 1].x +
      firstRow[firstRow.length - 1].width;

    expect(gridColumns).toBe(columns);
    expect(feedBox).not.toBeNull();
    expect(posterBox).not.toBeNull();
    expect(posterBox!.width).toBeLessThanOrEqual(maxPosterWidth);
    expect((rowLeft + rowRight) / 2).toBeCloseTo(
      feedBox!.x + feedBox!.width / 2,
      0
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBe(width);
  }
});
