import { expect, test } from "@playwright/test";
import { mockApi } from "./support/auth";

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
