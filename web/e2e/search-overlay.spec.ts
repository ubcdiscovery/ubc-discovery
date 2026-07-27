import { expect, test } from "@playwright/test";
import { mockApi, mockEvent } from "./support/auth";

test("traps focus in one modal search dialog and restores its opener", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto("/");

  const opener = page.getByRole("button", { name: "Search events" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Search events" });
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toBeVisible();
  await expect(page.locator("[inert]")).toHaveCount(1);

  const searchInput = dialog.getByRole("combobox");
  const closeButton = dialog.getByRole("button", { name: "Close search" });
  await expect(searchInput).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(searchInput).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("opens the shared search dialog from the desktop keyboard shortcut", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop keyboard shortcut coverage.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockApi(page);
  await page.goto("/");

  await expect(page.getByTestId("desktop-header")).toBeVisible();
  await page.getByRole("button", { name: "Search events" }).focus();

  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search events" });
  await expect(dialog).toHaveCount(1);
  await expect(dialog.getByRole("combobox")).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
});

test("does not activate a selected result from the close button", async ({
  page,
}) => {
  await mockApi(page);
  await page.route("http://api.test/events/search?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [mockEvent], total: 1 }),
    })
  );
  await page.goto("/");

  await page.getByRole("button", { name: "Search events" }).click();
  const dialog = page.getByRole("dialog", { name: "Search events" });
  const searchInput = dialog.getByRole("combobox");
  await searchInput.fill("campus");
  await expect(dialog.getByRole("option")).toHaveCount(1);

  await searchInput.press("ArrowDown");
  await expect(searchInput).toHaveAttribute(
    "aria-activedescendant",
    "event-search-result-event-1"
  );

  const closeButton = dialog.getByRole("button", { name: "Close search" });
  await closeButton.focus();
  await closeButton.press("Enter");

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL("/");
});
