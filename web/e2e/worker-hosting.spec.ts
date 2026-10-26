import { expect, test } from "@playwright/test";

test("serves the SSR document and its JavaScript through the Worker asset binding", async ({
  request,
}) => {
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
});

test("keeps an unknown deep link as an SSR 404 rather than an asset fallback", async ({
  request,
}) => {
  const response = await request.get("/worker-hosting-missing-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain("<html");
});

test("serves the API under /api from the same Worker", async ({ request }) => {
  const health = await request.get("/api/");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok", app: "UBC Discovery API" });

  const missing = await request.get("/api/worker-hosting-missing-route");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).toContain("application/json");
  expect(await missing.json()).toEqual({ detail: "Not Found" });

  // A page route that shares a name with an API route still renders the page.
  const page = await request.get("/events/worker-hosting-missing-event");
  expect(page.headers()["content-type"]).toContain("text/html");
});
