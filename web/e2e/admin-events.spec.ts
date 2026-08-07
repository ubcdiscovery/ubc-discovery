import { expect, test } from "@playwright/test";
import {
  adminProfile,
  existingProfile,
  mockApi,
  mockEvent,
  setAuthenticatedUser,
} from "./support/auth";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("administrator enters the admin catalogue from the account menu", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The account dropdown is part of the desktop navigation shell.");
  await mockApi(page, { profile: adminProfile, adminEvents: [mockEvent] });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/");
  await page.getByRole("button", { name: adminProfile.preferred_name }).click();
  await page.getByRole("menuitem", { name: "Administration" }).click();

  await expect(page).toHaveURL("/admin/events");
  await expect(page.getByRole("heading", { name: "Event Listings" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Canonical Event Listings" })).toBeVisible();
  await expect(page.getByRole("link", { name: mockEvent.title })).toBeVisible();
  await expect(page.getByTestId("desktop-header")).toHaveCount(0);
  await expect(page.getByTestId("bottom-tabs")).toHaveCount(0);

  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("ordinary Member is denied before the admin catalogue loads", async ({ page }) => {
  let adminRequests = 0;
  await mockApi(page, {
    profile: existingProfile,
    adminEvents: [mockEvent],
    onAdminList: () => adminRequests++,
  });
  await setAuthenticatedUser(page);

  await page.goto("/admin/events");

  await expect(page.getByRole("heading", { name: "Administrator access required." })).toBeVisible();
  expect(adminRequests).toBe(0);
  await expect(page.getByRole("link", { name: "Return to profile" })).toBeVisible();
});

test("Visitor is sent to sign in with the admin return path", async ({ page }) => {
  await mockApi(page, { profile: null, adminEvents: [mockEvent] });

  await page.goto("/admin/events");

  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fadmin%2Fevents$/);
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
});

test("administrator searches the canonical catalogue", async ({ page }) => {
  const queries: string[] = [];
  await mockApi(page, {
    profile: adminProfile,
    adminEvents: [
      mockEvent,
      { ...mockEvent, id: "event-2", title: "Faculty Research Forum" },
    ],
    onAdminList: (query) => queries.push(query),
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto("/admin/events");

  await page.getByRole("searchbox", { name: "Search Event Listings" }).fill("Research");
  await page.getByRole("button", { name: "Search catalogue" }).click();

  await expect(page).toHaveURL(/q=Research/);
  await expect(page.getByRole("link", { name: "Faculty Research Forum" })).toBeVisible();
  await expect(page.getByRole("link", { name: mockEvent.title })).toHaveCount(0);
  expect(queries).toContain("Research");
});

test("administrator edits a canonical Event Listing", async ({ page }) => {
  let update: Record<string, unknown> | undefined;
  await mockApi(page, {
    profile: adminProfile,
    adminEvents: [mockEvent],
    onAdminUpdate: (body) => {
      update = body;
    },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/events/${mockEvent.id}`);

  await expect(page.getByRole("link", { name: "← Event Listings" })).toHaveCount(0);
  await page.getByLabel("Title").fill("Updated Campus Welcome");
  await page.getByLabel("Location text").fill("AMS Nest Great Hall");
  await page.getByLabel("Event Source label").selectOption("ams_club");
  await page.getByText("Academic", { exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status")).toHaveText("Changes saved.");
  expect(update).toMatchObject({
    title: "Updated Campus Welcome",
    location_name: "AMS Nest Great Hall",
    source_label: "ams_club",
    club_name: null,
    vibes: ["social", "academic"],
  });
});

test("administrator uploads an Event Listing image", async ({ page }) => {
  let uploads = 0;
  await mockApi(page, {
    profile: adminProfile,
    adminEvents: [mockEvent],
    onAdminImageUpload: () => uploads++,
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/events/${mockEvent.id}`);

  await page.getByLabel("Choose image").setInputFiles({
    name: "poster.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(page.getByText("Selected: poster.png")).toBeVisible();
  await page.getByRole("button", { name: "Upload image" }).click();

  await expect(page.getByRole("status")).toHaveText("Image uploaded.");
  expect(uploads).toBe(1);
});
