import { expect, test, type Page } from "@playwright/test";
import { existingProfile, mockApi, setAuthenticatedUser } from "./support/auth";

const adminProfile = { ...existingProfile, is_admin: true };

const pending = {
  id: "sub-1",
  submitted_by_id: "member-1",
  title: "Board Game Night",
  description: "Fifty games, snacks provided.",
  club_name: "UBC Board Game Club",
  source_label: "ams_club",
  source_url: "https://example.com/boardgames",
  external_cta_label: "Reserve a seat",
  vibes: ["social", "culture"],
  location_name: "Nest Room 2301",
  event_date: "2027-10-03T18:30:00Z",
  event_end_date: null,
  status: "pending",
  review_note: null,
  reviewed_at: null,
  published_event_id: null,
  created_at: "2026-08-05T00:00:00Z",
};

const publishedEvent = {
  id: "ev-1",
  title: "Night Market at the Nest",
  description: "Twenty student vendors.",
  source: "submission",
  source_label: "campus_community",
  source_url: null,
  external_cta_label: null,
  club_name: "AMS Events",
  event_picture_url: null,
  vibes: ["food"],
  location_name: "AMS Nest, Level 2",
  event_date: "2027-08-22T01:00:00Z",
  event_end_date: null,
  created_at: "2026-08-05T00:00:00Z",
};

type Calls = { approved: string[]; rejected: { id: string; note: unknown }[] };

/** Registered after mockApi so it wins over the catch-all. */
async function mockQueue(page: Page, calls: Calls, queue = [pending]) {
  await page.route("http://api.test/event-submissions**", async (route) => {
    const url = new URL(route.request().url());
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    const approve = url.pathname.match(/^\/event-submissions\/(.+)\/approve$/);
    if (approve) {
      calls.approved.push(approve[1]);
      return json(200, { id: "ev1", title: pending.title });
    }
    const reject = url.pathname.match(/^\/event-submissions\/(.+)\/reject$/);
    if (reject) {
      calls.rejected.push({
        id: reject[1],
        note: route.request().postDataJSON()?.review_note,
      });
      return json(200, { ...pending, status: "rejected" });
    }
    return json(200, { submissions: queue, total: queue.length });
  });
}

test("a visitor is sent to sign in", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: /sign in first/i })).toBeVisible();
  // Scoped to the gate: the top nav has its own "Sign in" link.
  await page.locator("main").getByRole("link", { name: /sign in/i }).click();
  await expect(page).toHaveURL("/sign-in?redirect=%2Fadmin");
});

test("a member without the admin flag is refused", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockQueue(page, calls);
  await page.goto("/admin");

  await expect(
    page.getByRole("heading", { name: /not a reviewer/i })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
});

test("an admin approves a submission and it leaves the queue", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Board Game Night" })).toBeVisible();
  await page.getByRole("button", { name: /approve/i }).click();

  await expect(page.getByRole("status")).toContainText(/live on discover/i);
  await expect(page.getByRole("heading", { name: "Board Game Night" })).toHaveCount(0);
  expect(calls.approved).toEqual(["sub-1"]);
});

test("declining asks for a reason and sends it", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls);
  await page.goto("/admin");

  await page.getByRole("button", { name: /^decline$/i }).click();
  await page.getByRole("textbox").fill("We need a room number.");
  await page.getByRole("button", { name: /confirm decline/i }).click();

  await expect(page.getByRole("status")).toContainText(/declined/i);
  expect(calls.rejected).toEqual([
    { id: "sub-1", note: "We need a room number." },
  ]);
  expect(calls.approved).toEqual([]);
});

test("an empty queue says so", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls, []);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: /queue is empty/i })).toBeVisible();
});

/** Desktop puts the account menu in the top nav; mobile uses the burger menu. */
async function openNavMenu(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: /open site menu/i }).click();
  } else {
    await page.getByRole("button", { name: /taylor/i }).first().click();
  }
}

test("the review queue link is hidden from non-admins", async ({ page }, info) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: existingProfile });
  await mockQueue(page, calls);
  await page.goto("/");

  await openNavMenu(page, info.project.name === "mobile");
  await expect(page.getByRole("menuitem", { name: /review queue/i })).toHaveCount(0);
});

test("the review queue link is offered to admins", async ({ page }, info) => {
  const calls: Calls = { approved: [], rejected: [] };
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls);
  await page.goto("/");

  await openNavMenu(page, info.project.name === "mobile");
  await page.getByRole("menuitem", { name: /review queue/i }).click();
  await expect(page).toHaveURL("/admin");
});

test("an admin deletes a published event after confirming", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  const deleted: string[] = [];
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls, []);

  await page.route("http://api.test/events*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        events: [{ ...publishedEvent }],
      }),
    })
  );
  await page.route("http://api.test/events/ev-1", (route) => {
    deleted.push("ev-1");
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/admin");

  const row = page.locator("li").filter({ hasText: "Night Market" });
  await expect(row).toBeVisible();

  // One click only arms it; nothing is deleted yet.
  await row.getByRole("button", { name: /^delete$/i }).click();
  expect(deleted).toEqual([]);
  await expect(row.getByText(/delete for good/i)).toBeVisible();

  await row.getByRole("button", { name: /yes, delete/i }).click();
  await expect(page.getByText("Night Market")).toHaveCount(0);
  expect(deleted).toEqual(["ev-1"]);
});

test("backing out of a delete keeps the event", async ({ page }) => {
  const calls: Calls = { approved: [], rejected: [] };
  const deleted: string[] = [];
  await setAuthenticatedUser(page);
  await mockApi(page, { profile: adminProfile });
  await mockQueue(page, calls, []);

  await page.route("http://api.test/events*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [{ ...publishedEvent }] }),
    })
  );
  await page.route("http://api.test/events/ev-1", (route) => {
    deleted.push("ev-1");
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/admin");
  const row = page.locator("li").filter({ hasText: "Night Market" });
  await row.getByRole("button", { name: /^delete$/i }).click();
  await row.getByRole("button", { name: /keep/i }).click();

  await expect(row).toBeVisible();
  expect(deleted).toEqual([]);
});
