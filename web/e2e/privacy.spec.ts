import { expect, test } from "@playwright/test";
import { mockApi } from "./support/auth";

test("the home page links to the privacy policy", async ({ page, isMobile }) => {
  await mockApi(page);
  await page.goto("/");

  if (isMobile) {
    await page.getByRole("button", { name: "Open site menu" }).click();
    await page.getByRole("menuitem", { name: "Privacy" }).click();
  } else {
    await page.getByRole("link", { name: "Privacy policy" }).click();
  }

  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What we collect, and why");
  await expect(page.getByRole("note")).toContainText("Draft for review");
  await expect(page.getByRole("link", { name: "hi@ubcdiscovery.com" }).first()).toHaveAttribute(
    "href",
    "mailto:hi@ubcdiscovery.com",
  );
  await expect(
    page.getByRole("link", { name: "Google API Services User Data Policy" }),
  ).toBeVisible();
});

test("the sign-in page links to the privacy policy", async ({ page }) => {
  await mockApi(page);
  await page.goto("/sign-in");

  await page.getByRole("link", { name: "privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
});
