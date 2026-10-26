import { expect, test } from "@playwright/test";
import { existingProfile, mockApi, mockEvent } from "./support/auth";

test("resumes a Save after an existing member signs in", async ({ page }) => {
  let saves = 0;
  await mockApi(page, { profile: existingProfile, onSave: () => saves++ });
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [mockEvent], total: 1 }),
    }),
  );
  await page.goto("/");
  await page.locator('button[aria-label="Save event"]:visible').click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.sessionStorage.getItem("ubc-discovery-auth-flow");
        return value ? JSON.parse(value) : null;
      }),
    )
    .toMatchObject({
      version: 1,
      returnTo: "/events/event-1",
      actions: [
        {
          type: "save-event",
          payload: { eventId: "event-1" },
          status: "pending",
        },
      ],
    });

  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page).toHaveURL("/events/event-1");
  await expect.poll(() => saves).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("ubc-discovery-auth-flow")))
    .toBeNull();
});

test("does not loop a failed pending Save and allows retry", async ({ page }) => {
  let saves = 0;
  await mockApi(page, {
    profile: existingProfile,
    saveError: { status: 503, detail: "Unavailable" },
    onSave: () => saves++,
  });
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("ubc-discovery-auth-flow")) {
      const now = Date.now();
      window.sessionStorage.setItem(
        "ubc-discovery-auth-flow",
        JSON.stringify({
          version: 1,
          returnTo: "/events/event-1",
          actions: [
            {
              id: "pending-save-event-1",
              type: "save-event",
              payload: { eventId: "event-1" },
              status: "pending",
              attempts: 0,
            },
          ],
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    window.sessionStorage.setItem(
      "ubc-discovery-test-firebase-user",
      JSON.stringify({ uid: "existing-uid", email: "member@example.com" }),
    );
  });
  await page.goto("/events/event-1");
  await expect(page.getByRole("alert")).toContainText(/not saved/i);
  expect(saves).toBe(1);

  await page.reload();
  await expect(page.getByRole("alert")).toContainText(/not saved/i);
  expect(saves).toBe(1);
  await page.getByRole("button", { name: /retry save/i }).click();
  await expect.poll(() => saves).toBe(2);
  await page.getByRole("button", { name: /dismiss/i }).click();
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("ubc-discovery-auth-flow")))
    .toBeNull();
});

test("resumes a Save after a new member completes onboarding", async ({ page }) => {
  let saves = 0;
  await mockApi(page, { profile: null, onSave: () => saves++ });
  await page.route("http://api.test/events?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [mockEvent], total: 1 }),
    }),
  );
  await page.goto("/");
  await page.locator('button[aria-label="Save event"]:visible').click();
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page).toHaveURL("/welcome/name");

  await page.locator("input:visible").fill("New Member");
  await page.locator("button:visible", { hasText: /^continue/i }).click();
  await page.locator("button:visible", { hasText: /skip/i }).click();
  for (const interest of ["Social", "Career", "Academic"]) {
    await page.locator("button:visible", { hasText: interest }).click();
  }
  await page.locator("button:visible", { hasText: /finish setup/i }).click();

  await expect(page).toHaveURL("/events/event-1");
  await expect.poll(() => saves).toBe(1);
  await expect(page.getByRole("dialog", { name: /you.re in, new member/i })).toBeVisible();
  await page.getByRole("button", { name: /start exploring/i }).click();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("shows onboarding completion on the default destination", async ({ page }) => {
  await mockApi(page, { profile: null });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /continue with google/i }).click();
  await expect(page).toHaveURL("/welcome/name");

  await page.locator("input:visible").fill("New Member");
  await page.locator("button:visible", { hasText: /^continue/i }).click();
  await page.locator("button:visible", { hasText: /skip/i }).click();
  for (const interest of ["Social", "Career", "Academic"]) {
    await page.locator("button:visible", { hasText: interest }).click();
  }
  await page.locator("button:visible", { hasText: /finish setup/i }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog", { name: /you.re in, new member/i })).toBeVisible();
});
