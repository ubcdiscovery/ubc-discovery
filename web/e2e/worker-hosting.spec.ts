import { expect, test } from "@playwright/test";

test("serves the SSR document and its JavaScript through the Worker asset binding", async ({ request }) => {
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

test("keeps an unknown deep link as an SSR 404 rather than an asset fallback", async ({ request }) => {
  const response = await request.get("/worker-hosting-missing-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(await response.text()).toContain("<html");
});
