import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { ApiEnv } from "../src/env";
import { errorResponse, ApiError } from "../src/http/errors";

const env = { CORS_ALLOWED_ORIGINS: '["https://ubcdiscovery.ca"]' } as ApiEnv;

describe("API platform boundary", () => {
  it("preserves health and safe unknown-route errors", async () => {
    const app = createApp(env);
    expect(await (await app.handle(new Request("http://localhost/"))).json()).toEqual({ status: "ok", app: "UBC Discovery API" });
    const missing = await app.handle(new Request("http://localhost/missing"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ detail: "Not Found" });
  });
  it("permits browser preflight for an allowed origin", async () => {
    const response = await createApp(env).handle(new Request("http://localhost/events", {
      method: "OPTIONS", headers: { origin: "https://ubcdiscovery.ca", "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://ubcdiscovery.ca");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
  it("rejects preflight from an unknown origin", async () => {
    const response = await createApp(env).handle(new Request("http://localhost/events", {
      method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    }));
    expect(response.status).toBe(400);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });
  it("does not expose internal errors", async () => {
    expect(await errorResponse(new Error("private connection string")).json()).toEqual({ detail: "Internal Server Error" });
    expect(errorResponse(new ApiError(403, "Admin access required")).status).toBe(403);
  });
});
