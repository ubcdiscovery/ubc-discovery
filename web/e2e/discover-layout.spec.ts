import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

test("desktop filter rail reaches the viewport without a bottom rule", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The filter rail is only rendered on desktop.");
  await mockApi(page);
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [mockEvent], total: 1 }),
    })
  );

  await page.goto("/");

  await expect(page.locator("main")).toHaveCount(1);
  const rail = page.locator("aside");
  await expect(rail).toBeVisible();

  const railBox = await rail.boundingBox();
  const viewport = page.viewportSize();
  expect(railBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(railBox!.y + railBox!.height).toBeCloseTo(viewport!.height, 0);
  await expect(rail.locator("..")).toHaveCSS("border-bottom-width", "0px");
});
