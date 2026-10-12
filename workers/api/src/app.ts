import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { openapi } from "@elysiajs/openapi";
import type { ApiEnv } from "./env";
import { ApiError, errorResponse } from "./http/errors";

function corsOrigin(env: ApiEnv, request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const configured: unknown = JSON.parse(env.CORS_ALLOWED_ORIGINS || "[]");
  if (!Array.isArray(configured) || !configured.every(value => typeof value === "string")) {
    throw new Error("Invalid CORS_ALLOWED_ORIGINS");
  }
  if (configured.includes(origin)) return origin;
  if (env.CORS_ALLOWED_ORIGIN_REGEX && new RegExp(`^(?:${env.CORS_ALLOWED_ORIGIN_REGEX})$`).test(origin)) return origin;
  return null;
}

/** Construct and compile once per deployment, with no mutable request state. */
export function createApp(env: ApiEnv) {
  return new Elysia({ name: "ubc-discovery-api", adapter: CloudflareAdapter })
    .use(openapi({ path: "/docs", specPath: "/openapi.json", documentation: { info: { title: "UBC Discovery API", version: "0.1.0" } } }))
    .onRequest(({ request, set }) => {
      const origin = corsOrigin(env, request);
      if (origin) {
        set.headers["access-control-allow-origin"] = origin;
        set.headers["access-control-allow-credentials"] = "true";
      }
      set.headers["vary"] = "Origin";
      if (request.method === "OPTIONS" && request.headers.has("access-control-request-method")) {
        if (!origin) throw new ApiError(400, "Disallowed CORS origin");
        set.headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
        set.headers["access-control-allow-headers"] = request.headers.get("access-control-request-headers") || "authorization, content-type";
        set.headers["access-control-max-age"] = "600";
        set.status = 200;
        return "OK";
      }
    })
    .onError(({ code, error }) => {
      if (code === "NOT_FOUND") return Response.json({ detail: "Not Found" }, { status: 404 });
      if (code === "VALIDATION" || code === "PARSE") {
        return Response.json({ detail: "Invalid request" }, { status: code === "PARSE" ? 400 : 422 });
      }
      return errorResponse(error);
    })
    .get("/", () => ({ status: "ok", app: "UBC Discovery API" }), { detail: { tags: ["Health"] } })
    .compile();
}
