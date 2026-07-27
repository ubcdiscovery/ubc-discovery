import { expect, test } from "@playwright/test";
import {
  existingProfile,
  mockApi,
  setAuthenticatedUser,
} from "./support/auth";

test("mobile keeps site utilities in the header and identity in the bottom bar", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "This checks the mobile navigation shell.");
  await mockApi(page);
  await page.goto("/");

  const search = page.getByRole("button", { name: "Search events" });
  const menu = page.getByRole("button", { name: "Open site menu" });
  for (const control of [search, menu]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }

  await expect(page.getByRole("link", { name: "Sign In" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Profile" })).toHaveCount(0);

  await menu.click();
  await expect(
    page.getByRole("menuitem", { name: "For organizers" })
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Use dark mode" })
  ).toBeVisible();
});

test("mobile uses the same bottom position for a Member profile", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "This checks the mobile Member navigation shell.");
  await mockApi(page, { profile: existingProfile });
  await setAuthenticatedUser(page);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Profile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign In" })).toHaveCount(0);
});

test("navbar icon controls share one hover treatment", async ({
  page,
  isMobile,
}) => {
  await mockApi(page);
  await page.goto("/");

  const controls = isMobile
    ? [
        page.getByRole("button", { name: "Search events" }),
        page.getByRole("button", { name: "Open site menu" }),
      ]
    : [page.getByRole("button", { name: "Toggle theme" })];

  for (const control of controls) {
    await expect(control).toHaveClass(/border-transparent/);
    await expect(control).toHaveClass(/hover:border-white/);
    await expect(control).toHaveClass(/focus-visible:outline-accent/);
    await expect(control).not.toHaveClass(/hover:bg-/);
    await expect(control).not.toHaveClass(/hover:text-/);
  }
});
