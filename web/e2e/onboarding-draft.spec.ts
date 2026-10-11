import { expect, test } from "@playwright/test";
import { mockApi, setAuthenticatedUser } from "./support/auth";

test("restores an interrupted draft only for the same Firebase UID", async ({ page }) => {
  await mockApi(page, { profile: null });
  await setAuthenticatedUser(page, {
    uid: "account-a",
    email: "a@example.com",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ubc-discovery:onboarding-draft:account-a",
      JSON.stringify({ preferred_name: "Account A Draft" }),
    );
  });
  await page.goto("/welcome/name");
  await expect(page.locator("input:visible")).toHaveValue("Account A Draft");

  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "ubc-discovery-test-firebase-user",
      JSON.stringify({ uid: "account-b", email: "b@example.com" }),
    );
    window.dispatchEvent(new CustomEvent("ubc-test-auth-changed"));
  });
  await page.reload();
  await expect(page.locator("input:visible")).toHaveValue("");
});

test("discards a malformed account draft", async ({ page }) => {
  await mockApi(page, { profile: null });
  await setAuthenticatedUser(page, {
    uid: "account-a",
    email: "a@example.com",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ubc-discovery:onboarding-draft:account-a",
      JSON.stringify({ preferred_name: 42 }),
    );
  });
  await page.goto("/welcome/name");

  await expect(page.locator("input:visible")).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("ubc-discovery:onboarding-draft:account-a")),
    )
    .toBeNull();
});

test("normalizes a legacy academic draft to constrained identifiers", async ({ page }) => {
  await mockApi(page, { profile: null });
  await setAuthenticatedUser(page, {
    uid: "account-a",
    email: "a@example.com",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ubc-discovery:onboarding-draft:account-a",
      JSON.stringify({
        preferred_name: "Account A",
        faculty: "Science",
        year_standing: 3,
      }),
    );
  });
  await page.goto("/welcome/academic");

  const prefix = (page.viewportSize()?.width ?? 0) < 768 ? "mobile" : "desktop";
  await expect(page.locator(`#${prefix}-faculty`)).toHaveValue("Faculty of Science");
  if (prefix === "mobile") {
    await expect(page.locator("button:visible", { hasText: /^3rd year$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } else {
    await expect(page.locator("#desktop-year")).toHaveValue("3rd year");
  }
});

test("searches Vancouver faculties and accepts a custom program", async ({ page }) => {
  await mockApi(page, { profile: null });
  await setAuthenticatedUser(page, {
    uid: "account-a",
    email: "a@example.com",
  });
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "ubc-discovery:onboarding-draft:account-a",
      JSON.stringify({ preferred_name: "Account A" }),
    );
  });
  await page.goto("/welcome/academic");

  const prefix = (page.viewportSize()?.width ?? 0) < 768 ? "mobile" : "desktop";
  const faculty = page.locator(`#${prefix}-faculty`);
  const program = page.locator(`#${prefix}-major`);

  await faculty.fill("APSC");
  await expect(
    page.getByRole("option", { name: "Faculty of Applied Science (Engineering)" }),
  ).toBeVisible();
  await faculty.press("Enter");
  await expect(faculty).toHaveValue("Faculty of Applied Science (Engineering)");

  await program.click();
  await expect(page.getByRole("option", { name: "Undeclared / not yet selected" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Mechanical Engineering" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Combined Major/ })).toHaveCount(0);
  await program.fill("Combined Major in Business and Computer Science");
  await program.press("Escape");
  if (prefix === "mobile") {
    await page.locator("button:visible", { hasText: /^Graduate$/ }).click();
  } else {
    const year = page.locator("#desktop-year");
    await year.fill("Graduate");
    await year.press("Enter");
  }
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL("/welcome/interests");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem("ubc-discovery:onboarding-draft:account-a");
        return value ? JSON.parse(value) : null;
      }),
    )
    .toMatchObject({
      faculty_id: "applied-science",
      major: "Combined Major in Business and Computer Science",
      academic_level: "graduate",
    });
});
