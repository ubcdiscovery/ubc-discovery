import { expect, test } from "@playwright/test";
import { existingProfile, mockApi, setAuthenticatedUser } from "./support/auth";

test.beforeEach(async ({ page }) => {
  await setAuthenticatedUser(page);
});

test("edits and clears profile fields from every supported viewport", async ({ page }) => {
  let submitted: Record<string, unknown> | null = null;
  await mockApi(page, {
    profile: existingProfile,
    onProfileUpdate: (body) => {
      submitted = body;
    },
  });
  await page.goto("/profile");

  await expect(page.getByRole("button", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByText("Taylor", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Edit profile" }).click();

  await expect(page.getByRole("option", { name: "Graduate" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Postdoc" })).toHaveCount(0);
  await page.getByLabel("Preferred name").fill("Updated Taylor");
  await page.getByLabel("Faculty").selectOption("");
  await page.getByLabel("Major or program").fill("");
  await page.getByLabel("Year").selectOption("");
  await page.getByRole("button", { name: "[SOCIAL]" }).click();
  await page.getByRole("button", { name: /Save changes/ }).click();

  await expect.poll(() => submitted).toEqual({
    preferred_name: "Updated Taylor",
    faculty: null,
    major: null,
    year_standing: null,
    interests: ["music", "outdoors", "food", "social"],
  });
  await expect(page.getByRole("heading", { name: "Updated Taylor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit profile" })).toBeVisible();
  await expect(page.getByText("Not specified", { exact: true })).toHaveCount(3);
});

test("cancelling discards the profile draft without sending an update", async ({ page }) => {
  let updateCount = 0;
  await mockApi(page, {
    profile: existingProfile,
    onProfileUpdate: () => {
      updateCount += 1;
    },
  });
  await page.goto("/profile");

  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByLabel("Preferred name").fill("Discarded name");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("heading", { name: "Taylor" })).toBeVisible();
  expect(updateCount).toBe(0);
});
