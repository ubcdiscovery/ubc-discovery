import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

const posterDataUrl = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
    <rect width="1080" height="1350" fill="#1e40ff" />
    <rect x="80" y="80" width="920" height="1190" fill="#e0ff4f" />
  </svg>
`)}`;

test("shows an Instagram portrait poster without cropping", async ({ page }) => {
  await mockApi(page);
  await page.route("http://api.test/events/event-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockEvent,
        event_picture_url: posterDataUrl,
      }),
    })
  );

  await page.goto("/events/event-1");

  const poster = page
    .locator('main img[src^="data:image/svg+xml"]')
    .filter({ visible: true });
  await expect(poster).toBeVisible();
  await expect
    .poll(() =>
      poster.evaluate((image) => (image as HTMLImageElement).naturalWidth)
    )
    .toBe(1080);

  const renderedRatio = await poster.evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return bounds.width / bounds.height;
  });
  expect(renderedRatio).toBeCloseTo(1080 / 1350, 2);
});
