import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { existingProfile, mockApi, setAuthenticatedUser } from "./support/auth";

/** A real PNG: createImageBitmap rejects hand-rolled byte blobs. */
const POSTER_FIXTURE = fileURLToPath(
  new URL("./fixtures/poster.png", import.meta.url)
);

const approvedSubmission = {
  id: "sub-approved",
  submitted_by_id: existingProfile.id,
  title: "Night Market at the Nest",
  description: "Twenty student vendors.",
  club_name: "AMS Events",
  source_label: "campus_community",
  source_url: null,
  external_cta_label: null,
  vibes: ["food", "social"],
  location_name: "AMS Nest, Level 2",
  event_date: "2027-01-22T01:00:00Z",
  event_end_date: null,
  status: "approved",
  review_note: null,
  reviewed_at: "2026-08-06T00:00:00Z",
  published_event_id: "event-1",
  created_at: "2026-08-05T00:00:00Z",
};

const rejectedSubmission = {
  ...approvedSubmission,
  id: "sub-rejected",
  title: "Free Pizza Somewhere",
  location_name: "TBD",
  status: "rejected",
  review_note: "We need a real location before this can go live.",
  published_event_id: null,
};

type SubmissionRoutes = {
  history?: unknown[];
  onCreate?: (body: Record<string, unknown>) => void;
};

/** Registered after mockApi so these paths take precedence over its catch-all. */
async function mockSubmissions(
  page: Page,
  { history = [], onCreate }: SubmissionRoutes = {}
) {
  await page.route("http://api.test/event-submissions*", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/event-submissions/mine") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ submissions: history, total: history.length }),
      });
    }

    onCreate?.(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ...approvedSubmission, id: "sub-new", status: "pending" }),
    });
  });
  await page.route("http://api.test/event-submissions/mine", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ submissions: history, total: history.length }),
    })
  );
}

test("sends a visitor to sign-in instead of the submission form", async ({
  page,
}) => {
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page);
  await page.goto("/organizers");

  await expect(
    page.getByRole("heading", { name: /sign in to submit/i })
  ).toBeVisible();
  await expect(page.getByPlaceholder("UBC Outdoor Club")).toHaveCount(0);

  await page.getByRole("link", { name: /sign in to submit an event/i }).click();
  await expect(page).toHaveURL("/sign-in?redirect=%2Forganizers");
});

test("blocks an empty submission without calling the API", async ({ page }) => {
  let created = 0;
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page, { onCreate: () => (created += 1) });
  await page.goto("/organizers");

  await page.getByRole("button", { name: /send for review/i }).click();

  await expect(page.getByRole("alert")).toContainText(/name/i);
  expect(created).toBe(0);

  // The message clears once the organizer starts fixing the problem.
  await page.getByPlaceholder("Sunrise Hike at Quarry Rock").fill("Board Games");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("submits an event for review and confirms it is pending", async ({
  page,
}) => {
  const created: Record<string, unknown>[] = [];
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page, { onCreate: (payload) => created.push(payload) });
  await page.goto("/organizers");

  await page
    .getByPlaceholder("Sunrise Hike at Quarry Rock")
    .fill("Board Game Night");
  await page.getByPlaceholder("UBC Outdoor Club").fill("UBC Board Game Club");
  await page.getByPlaceholder("AMS Nest, Level 2").fill("Nest Room 2301");
  await page
    .locator('input[type="datetime-local"]')
    .first()
    .fill("2027-10-03T18:30");
  await page.getByText("[SOCIAL]").click();
  await page.getByText("[CULTURE]").click();

  await page.getByRole("button", { name: /send for review/i }).click();

  await expect(
    page.getByRole("heading", { name: /is with the reviewers/i })
  ).toBeVisible();

  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    title: "Board Game Night",
    club_name: "UBC Board Game Club",
    location_name: "Nest Room 2301",
    source_label: "ams_club",
    vibes: ["social", "culture"],
  });
  // datetime-local is wall-clock; the client converts it to a UTC instant.
  expect(String(created[0].event_date)).toMatch(/Z$/);
});

test("caps the vibe picker at three", async ({ page }) => {
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page);
  await page.goto("/organizers");

  for (const vibe of ["[SOCIAL]", "[CAREER]", "[ACADEMIC]"]) {
    await page.getByText(vibe).click();
  }

  await expect(
    page.getByText("[ARTS]").locator("xpath=ancestor::button[1]")
  ).toBeDisabled();
});

test("shows the outcome of past submissions", async ({ page }) => {
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page, {
    history: [approvedSubmission, rejectedSubmission],
  });
  await page.goto("/organizers");

  await expect(page.getByText("Night Market at the Nest")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /view it on discover/i })
  ).toHaveAttribute("href", "/events/event-1");

  await expect(page.getByText("Free Pizza Somewhere")).toBeVisible();
  await expect(
    page.getByText(/real location before this can go live/i)
  ).toBeVisible();
});

test("attaches a cover image after the submission is created", async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  let presignedFor: string | null = null;
  let uploaded = false;

  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page, { onCreate: (payload) => created.push(payload) });

  await page.route("http://api.test/event-submissions/*/presigned-upload", (route) => {
    presignedFor = new URL(route.request().url()).pathname.split("/")[2];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        upload_url: "https://s3.test/upload",
        fields: { key: "submission-pictures/x.webp" },
        file_key: "submission-pictures/x.webp",
        max_file_size_bytes: 3145728,
      }),
    });
  });
  await page.route("https://s3.test/upload", (route) => {
    uploaded = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/organizers");

  await page.setInputFiles('input[type="file"]', POSTER_FIXTURE);
  await expect(page.getByAltText("Your cover image")).toBeVisible();

  await page.getByPlaceholder("Sunrise Hike at Quarry Rock").fill("Poster Night");
  await page.getByPlaceholder("UBC Outdoor Club").fill("UBC Poster Club");
  await page.getByPlaceholder("AMS Nest, Level 2").fill("Nest 2301");
  await page.locator('input[type="datetime-local"]').first().fill("2027-11-04T18:30");
  await page.getByText("[ARTS]").click();
  await page.getByRole("button", { name: /send for review/i }).click();

  await expect(
    page.getByRole("heading", { name: /is with the reviewers/i })
  ).toBeVisible();
  expect(created).toHaveLength(1);
  expect(presignedFor).toBe("sub-new");
  expect(uploaded).toBe(true);
});

test("a failed image upload still keeps the submission", async ({ page }) => {
  const created: Record<string, unknown>[] = [];
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockSubmissions(page, { onCreate: (payload) => created.push(payload) });

  await page.route("http://api.test/event-submissions/*/presigned-upload", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
  );

  await page.goto("/organizers");
  await page.setInputFiles('input[type="file"]', POSTER_FIXTURE);
  await page.getByPlaceholder("Sunrise Hike at Quarry Rock").fill("Poster Night");
  await page.getByPlaceholder("UBC Outdoor Club").fill("UBC Poster Club");
  await page.getByPlaceholder("AMS Nest, Level 2").fill("Nest 2301");
  await page.locator('input[type="datetime-local"]').first().fill("2027-11-04T18:30");
  await page.getByText("[ARTS]").click();
  await page.getByRole("button", { name: /send for review/i }).click();

  // The listing is in the queue; only the image failed, and it says so.
  await expect(
    page.getByRole("heading", { name: /is with the reviewers/i })
  ).toBeVisible();
  expect(created).toHaveLength(1);
});
