import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { withDatabase } from "../db";
import { authRequest } from "../auth";
import type { ApiEnv } from "../env";
import { createServices, type ServicesFactory } from "../services";

export function createBetterAuthRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  // A mount hands Better Auth the raw request; Elysia would otherwise read the body.
  return new Elysia({ name: "better-auth", adapter: CloudflareAdapter, normalize: false }).mount(
    "/auth",
    (request: Request) => {
      const services = servicesFactory();
      return withDatabase(env, (db) => services.auth(db).handler(authRequest(env, request)));
    },
  );
}
