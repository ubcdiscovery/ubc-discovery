import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { openapi } from "@elysiajs/openapi";
import type { ApiEnv } from "./env";
import { ApiError, errorResponse } from "./http/errors";
import { createEventRoutes } from "./routes/events";
import { createRecommendationRoutes } from "./routes/recommendations";
import { createMemberRoutes } from "./routes/users";
import { createAdminRoutes } from "./routes/admin";
import { createIngestionRoutes } from "./routes/ingestion";
import { createExtractionRoutes } from "./routes/extraction";
import { createStorageRoutes } from "./routes/storage";
import { createServices, type ServicesFactory } from "./services";

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
export function createApp(env: ApiEnv, servicesFactory: ServicesFactory = () => createServices(env)) {
  return new Elysia({ name: "ubc-discovery-api", adapter: CloudflareAdapter, normalize: false })
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
        return Response.json({ detail: "Invalid request" }, { status: 422 });
      }
      return errorResponse(error);
    })
    .onTransform(({ query }) => {
      // Starlette's scalar query parameters use the last repeated value. Elysia
      // initially parses repetitions as arrays; collapse before validation.
      const scalarQuery = query as Record<string, string | string[]>;
      for (const [key, value] of Object.entries(scalarQuery)) {
        if (Array.isArray(value)) scalarQuery[key] = value.at(-1) ?? "";
      }
    })
    .get("/", () => ({ status: "ok", app: "UBC Discovery API" }), { detail: { tags: ["Health"] } })
    .use(createEventRoutes(env, servicesFactory))
    .use(createRecommendationRoutes(env, servicesFactory))
    .use(createMemberRoutes(env, servicesFactory))
    .use(createAdminRoutes(env, servicesFactory))
    .use(createIngestionRoutes(env, servicesFactory))
    .use(createExtractionRoutes(env, servicesFactory))
    .use(createStorageRoutes(env))
    .compile();
}
