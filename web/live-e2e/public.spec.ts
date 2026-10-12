import { test, expect } from "./support/fixtures";

test("deployed Worker serves SSR/assets and public API discovery/detail", async ({ page, request, live }) => {
  const health = await request.get(`${live.apiBaseUrl}/`);
  expect(health.status()).toBe(200);
  const response = await request.get("/sign-in");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  const document = await response.text();
  expect(document).toContain("<html");
  expect(document).toContain("UBC Discovery");
  const scriptPath = document.match(/(?:src|href)="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  expect(scriptPath).toBeDefined();
  const script = await request.get(scriptPath!);
  expect(script.status()).toBe(200);
  expect(script.headers()["content-type"]).toContain("javascript");
  const missing = await request.get("/live-missing-route");
  expect(missing.status()).toBe(404);

  const eventResponse = await request.get(`${live.apiBaseUrl}/events/${live.futureEvent.id}`);
  expect(eventResponse.status()).toBe(200);
  const event = await eventResponse.json();
  expect(event.title).toBe(live.futureEvent.title);
  const search = await request.get(`${live.apiBaseUrl}/events/search`, { params: { q: live.runId } });
  expect(search.status()).toBe(200);
  expect((await search.json()).events.map((item: { id: string }) => item.id)).toContain(live.futureEvent.id);

  const apiResponse = page.waitForResponse(response => response.url() === `${live.apiBaseUrl}/events/${live.futureEvent.id}`);
  await page.goto(`/events/${live.futureEvent.id}`);
  expect((await apiResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: live.futureEvent.title }).filter({ visible: true })).toBeVisible();
  const description = page.locator("p").filter({ hasText: live.futureEvent.description }).filter({ visible: true });
  await expect(description).toHaveCount(1);
  await expect(description).toHaveText(live.futureEvent.description);
  await expect(description).toHaveCSS("white-space", "pre-wrap");
});

test("real visitor has sign-in affordances and API/UI member barriers", async ({ page, request, live }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: /sign in/i }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.locator('input[type="email"]:visible')).toBeVisible();
  await page.goto("/saved");
  await page.getByRole("link", { name: /sign in to save/i }).click();
  await expect(page).toHaveURL(`${live.webBaseUrl}/sign-in?redirect=%2Fsaved`);
  await page.goto("/admin/events");
  await expect(page).toHaveURL(/\/sign-in\?redirect=%2Fadmin%2Fevents$/);
  for (const path of ["/users/me", "/saved-events", "/admin/events", "/recommendations/events/for-you"]) {
    expect((await request.get(`${live.apiBaseUrl}${path}`)).status(), path).toBe(401);
  }
});
