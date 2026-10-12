import { test, expect, loadLiveFixture, memberStorageState } from "./support/fixtures";

test.use({ storageState: memberStorageState(loadLiveFixture()) });

test.beforeEach(async ({ memberApi, live }) => {
  const profile = await memberApi.get("/users/me");
  expect(profile.status()).toBe(200);
  const body = await profile.json();
  expect(body.id).toBe(live.member.profileId);
  expect(body.preferred_name).toBe(live.member.preferredName);
  expect(body.is_admin).toBe(live.member.isAdmin);
  for (const event of [live.futureEvent, live.pastEvent]) {
    const response = await memberApi.get(`/events/${event.id}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.title).toBe(event.title);
    const end = new Date(body.event_end_date).getTime();
    if (event.id === live.futureEvent.id) {
      if (!Number.isFinite(end) || end <= Date.now() + 120_000) throw new Error("The future fixture must remain future for the complete test; refusing mutation.");
    } else if (!Number.isFinite(end) || end >= Date.now()) {
      throw new Error("The past fixture needs an end time before now.");
    }
  }
});

test("real Firebase session hydrates, survives reload, and persists profile changes", async ({ page, memberApi, live }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: live.member.preferredName }).filter({ visible: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Edit profile" })).toBeVisible();
  const updatedName = `${live.member.preferredName} updated`;
  try {
    await page.getByRole("button", { name: "Edit profile" }).click();
    await page.getByLabel("Preferred name").fill(updatedName);
    const update = page.waitForResponse(response => response.url() === `${live.apiBaseUrl}/users/me` && response.request().method() === "PUT");
    await page.getByRole("button", { name: /Save changes/ }).click();
    expect((await update).status()).toBe(200);
    await expect(page.getByRole("heading", { name: updatedName }).filter({ visible: true })).toBeVisible();
    expect((await (await memberApi.get("/users/me")).json()).preferred_name).toBe(updatedName);
    await page.reload();
    await expect(page.getByRole("heading", { name: updatedName }).filter({ visible: true })).toBeVisible();
  } finally {
    const restored = await memberApi.put("/users/me", { data: { preferred_name: live.member.preferredName } });
    expect(restored.status()).toBe(200);
  }
});

test("saves through deployed API, partitions Saved tabs, and removes the event", async ({ page, memberApi, live }) => {
  const saved = await memberApi.get("/saved-events", { params: { limit: 100 } });
  expect(saved.status()).toBe(200);
  const originalIds = (await saved.json()).saved_events.map((item: { event: { id: string } }) => item.event.id);
  expect(originalIds).not.toContain(live.futureEvent.id);
  expect(originalIds).not.toContain(live.pastEvent.id);
  try {
    const hydratedSaves = page.waitForResponse(response =>
      new URL(response.url()).origin === live.apiBaseUrl && new URL(response.url()).pathname === "/saved-events" && response.request().method() === "GET",
      { timeout: 15_000 });
    await page.goto(`/events/${live.futureEvent.id}`);
    expect((await hydratedSaves).status()).toBe(200);
    const save = page.waitForResponse(response => response.url() === `${live.apiBaseUrl}/saved-events/${live.futureEvent.id}` && response.request().method() === "PUT", { timeout: 15_000 });
    await page.getByRole("button", { name: "Save event", exact: true }).filter({ visible: true }).click();
    expect((await save).status()).toBe(201);
    await expect(page.getByRole("button", { name: "Remove from saved events" }).filter({ visible: true })).toBeVisible();
    expect((await memberApi.put(`/saved-events/${live.pastEvent.id}`)).status()).toBe(201);
    await page.goto("/saved?tab=past");
    await expect(page.getByRole("tab", { name: /past events/i })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: live.pastEvent.title })).toBeVisible();
    await expect(page.getByRole("heading", { name: live.futureEvent.title })).toHaveCount(0);
    await page.getByRole("tab", { name: /coming up/i }).click();
    await expect(page).toHaveURL(`${live.webBaseUrl}/saved?tab=upcoming`);
    await expect(page.getByRole("heading", { name: live.futureEvent.title })).toBeVisible();
    const unsave = page.waitForResponse(response => response.url() === `${live.apiBaseUrl}/saved-events/${live.futureEvent.id}` && response.request().method() === "DELETE");
    await page.getByRole("link", { name: `View ${live.futureEvent.title}` }).locator("..").getByRole("button", { name: "Remove from saved events" }).click();
    expect((await unsave).status()).toBe(204);
    await expect(page.getByRole("heading", { name: live.futureEvent.title })).toHaveCount(0);
  } finally {
    const cleanup = await Promise.allSettled([live.futureEvent, live.pastEvent].map(event => memberApi.delete(`/saved-events/${event.id}`)));
    // Attempt every removal, even if one transport request fails.
    expect(cleanup.map(result => result.status === "fulfilled" ? result.value.status() : "cleanup failed")).toEqual([204, 204]);
  }
});

test("real member role is enforced and recommendation/rating APIs load", async ({ page, memberApi, live }) => {
  expect((await memberApi.get("/admin/events")).status()).toBe(live.member.isAdmin ? 200 : 403);
  const recommendations = await memberApi.get("/recommendations/events/for-you", { params: { n: 10 } });
  expect(recommendations.status()).toBe(200);
  expect(Array.isArray((await recommendations.json()).events)).toBe(true);
  await page.goto("/admin/events");
  if (live.member.isAdmin) {
    await expect(page.getByRole("heading", { name: "Event Listings", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Canonical Event Listings" })).toBeVisible();
    await page.getByRole("searchbox", { name: "Search Event Listings" }).fill(live.runId);
    await page.getByRole("button", { name: "Search catalogue" }).click();
    await expect(page.getByRole("link", { name: live.futureEvent.title })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Administrator access required." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return to profile" })).toBeVisible();
  }
  const ratings = await memberApi.get(`/ratings/${live.pastEvent.id}`);
  expect(ratings.status()).toBe(200);
  expect(Array.isArray(await ratings.json())).toBe(true);
  expect((await memberApi.post(`/ratings/mine/${live.futureEvent.id}`, { data: { stars: 4, note: live.runId, strong_vibes: [] } })).status()).toBe(400);
});
