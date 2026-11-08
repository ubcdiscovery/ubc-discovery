import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { openapi } from "@elysiajs/openapi";
import type { ApiEnv } from "./env";
import { errorResponse } from "./http/errors";
import { createEventRoutes } from "./routes/events";
import { createRecommendationRoutes } from "./routes/recommendations";
import { createMemberRoutes } from "./routes/users";
import { createAdminRoutes } from "./routes/admin";
import { createIngestionRoutes } from "./routes/ingestion";
import { createExtractionRoutes } from "./routes/extraction";
import { createStorageRoutes } from "./routes/storage";
import { createServices, type ServicesFactory } from "./services";

export interface AppOptions {
  /**
   * Compile routes ahead of time with generated code (the default). Workers allow
   * that only at startup; the Vite dev server loads modules during a request, so
   * it uses Elysia's interpreted handlers instead.
   */
  aot?: boolean;
}

/** Construct and compile once per deployment, with no mutable request state. */
export function createApp(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
  { aot = true }: AppOptions = {},
) {
  return new Elysia({
    name: "ubc-discovery-api",
    adapter: aot ? CloudflareAdapter : undefined,
    aot,
    normalize: false,
  })
    .use(
      openapi({
        path: "/docs",
        specPath: "/openapi.json",
        documentation: { info: { title: "UBC Discovery API", version: "0.1.0" } },
      }),
    )
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

export type { SignInCodeSent } from "./auth";
