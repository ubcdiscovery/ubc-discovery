import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

const multilineDescription = "First line\nSecond line\n\nThird line";

test("preserves line breaks in the Event Listing description", async ({ page }) => {
  await mockApi(page);
  await page.route("http://api.test/events/event-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...mockEvent,
        description: multilineDescription,
      }),
    }),
  );

  await page.goto("/events/event-1");

  const description = page
    .locator("p")
    .filter({ hasText: "First line" })
    .filter({ visible: true });
  await expect(description).toHaveCount(1);
  await expect(description).toHaveText(multilineDescription);
  await expect(description).toHaveCSS("white-space", "pre-wrap");
});
