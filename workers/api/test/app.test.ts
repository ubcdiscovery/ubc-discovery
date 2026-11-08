import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app";
import type { ApiEnv } from "../src/env";
import { errorResponse, ApiError } from "../src/http/errors";

const env = {} as ApiEnv;

describe("API platform boundary", () => {
  it("preserves health and safe unknown-route errors", async () => {
    const app = createApp(env);
    expect(await (await app.handle(new Request("http://localhost/"))).json()).toEqual({
      status: "ok",
      app: "UBC Discovery API",
    });
    const missing = await app.handle(new Request("http://localhost/missing"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ detail: "Not Found" });
  });
  it("does not expose internal errors", async () => {
    expect(await errorResponse(new Error("private connection string")).json()).toEqual({
      detail: "Internal Server Error",
    });
    expect(errorResponse(new ApiError(403, "Admin access required")).status).toBe(403);
  });
  it("ignores extra scalar query parameters and uses the last repeated value", async () => {
    const app = createApp(env);
    for (const path of ["/events/search?q=a&extra=ignored", "/events/search?q=long&q=a"]) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ events: [] });
    }
  });
});
