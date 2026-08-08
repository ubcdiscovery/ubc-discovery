import { expect, test } from "@playwright/test";
import {
  adminProfile,
  existingProfile,
  mockApi,
  mockEvent,
  setAuthenticatedUser,
} from "./support/auth";
import { mockCandidate } from "./support/candidates";

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

test("administrator paginates the canonical catalogue", async ({ page }) => {
  const events = Array.from({ length: 26 }, (_, index) => ({
    ...mockEvent,
    id: `event-${index + 1}`,
    title: `Admin Pagination Event ${index + 1}`,
  }));
  await mockApi(page, { profile: adminProfile, adminEvents: events });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/events");

  const firstEventLink = page.locator(`a[href="/admin/events/${events[0].id}"]`);
  const lastEventLink = page.locator(`a[href="/admin/events/${events[25].id}"]`);
  await expect(firstEventLink).toBeVisible();
  await expect(lastEventLink).toHaveCount(0);
  await expect(page.getByText("1–25", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Next →" }).click();

  await expect(page).toHaveURL("/admin/events?page=1");
  await expect(firstEventLink).toHaveCount(0);
  await expect(lastEventLink).toBeVisible();
  await expect(page.getByText("26–26", { exact: true })).toBeVisible();
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
  await expect(
    page.getByRole("definition").filter({ hasText: /Campus Welcome\s*→\s*Updated Campus Welcome/ })
  ).toBeVisible();
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

test("administrator creates an Event Listing", async ({ page }) => {
  let created: Record<string, unknown> | undefined;
  let uploads = 0;
  await mockApi(page, {
    profile: adminProfile,
    onAdminCreate: (body) => {
      created = body;
    },
    onAdminImageUpload: () => uploads++,
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto("/admin/events/new");

  await expect(page.getByLabel("Choose image")).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload image" })).toHaveCount(0);

  await page.getByLabel("Title").fill("New Campus Workshop");
  await page.getByLabel("Location text").fill("The Nest");
  await page.getByLabel("Choose image").setInputFiles({
    name: "poster.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await page.getByRole("button", { name: "Create Event Listing" }).click();

  await expect(page).toHaveURL("/admin/events/created-event");
  await expect(page.getByRole("heading", { name: "New Campus Workshop" })).toBeVisible();
  expect(created).toMatchObject({ title: "New Campus Workshop", location_name: "The Nest" });
  expect(uploads).toBe(1);
});

test("administrator sees image upload failure after creating an Event Listing", async ({ page }) => {
  await mockApi(page, {
    profile: adminProfile,
    adminImageUploadError: { status: 500, detail: "Upload failed" },
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto("/admin/events/new");

  await page.getByLabel("Title").fill("Poster Pending Workshop");
  await page.getByLabel("Location text").fill("The Nest");
  await page.getByLabel("Choose image").setInputFiles({
    name: "poster.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await page.getByRole("button", { name: "Create Event Listing" }).click();

  await expect(page).toHaveURL("/admin/events/created-event");
  await expect(page.getByRole("alert")).toContainText(
    "Event Listing created, but the image could not be uploaded"
  );
  await expect(page.getByLabel("Choose image")).toBeVisible();
});

test("administrator archives and restores an Event Listing", async ({ page }) => {
  const events = [{ ...mockEvent, is_archived: false }];
  const archiveStates: boolean[] = [];
  await mockApi(page, {
    profile: adminProfile,
    adminEvents: events,
    onAdminArchive: (archived) => archiveStates.push(archived),
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto(`/admin/events/${mockEvent.id}`);

  await page.getByRole("button", { name: "Archive listing" }).click();
  await expect(page.getByRole("heading", { name: "Archived Event Listing" })).toBeVisible();
  await expect(page.getByText("archive", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Restore listing" }).click();
  await expect(page.getByRole("heading", { name: "Active Event Listing" })).toBeVisible();
  await expect(page.getByText("restore", { exact: true })).toBeVisible();
  expect(archiveStates).toEqual([true, false]);
});

test("administrator filters archived Event Listings", async ({ page }) => {
  await mockApi(page, {
    profile: adminProfile,
    adminEvents: [
      { ...mockEvent, title: "Active Mixer" },
      { ...mockEvent, id: "event-2", title: "Old Mixer", is_archived: true },
    ],
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });
  await page.goto("/admin/events");

  await expect(page.getByRole("link", { name: "Active Mixer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Old Mixer" })).toBeVisible();

  await page.getByRole("link", { name: "archived records" }).click();

  await expect(page).toHaveURL(/status=archived/);
  await expect(page.getByRole("link", { name: "Old Mixer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Active Mixer" })).toHaveCount(0);
});

test("administrator filters and inspects an Event Listing Candidate", async ({ page }) => {
  const candidateQueries: Array<{ q: string; status: string; sourceType: string }> = [];
  await mockApi(page, {
    profile: adminProfile,
    adminCandidates: [mockCandidate],
    onCandidateList: (filters) => candidateQueries.push(filters),
  });
  await setAuthenticatedUser(page, { uid: "admin-uid", email: adminProfile.email });

  await page.goto("/admin/candidates");

  await expect(page.getByRole("heading", { name: "Candidates" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Event Listing Candidates" })).toBeVisible();
  await expect(page.getByRole("link", { name: mockCandidate.title })).toBeVisible();

  await page.getByRole("combobox", { name: "Filter candidate status" }).selectOption("pending");
  await expect(page).toHaveURL(/status=pending/);
  expect(candidateQueries.at(-1)).toMatchObject({ status: "pending" });

  await page.getByRole("link", { name: mockCandidate.title }).click();

  await expect(page).toHaveURL(`/admin/candidates/${mockCandidate.id}`);
  await expect(page.getByRole("heading", { name: mockCandidate.title })).toBeVisible();
  await expect(page.getByText(mockCandidate.source_excerpt!)).toBeVisible();
  await expect(page.getByText("created", { exact: true })).toBeVisible();
  await expect(page.getByText("Campus importer", { exact: true })).toBeVisible();
});
