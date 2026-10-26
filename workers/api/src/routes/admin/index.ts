import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import type { ApiEnv } from "../../env";
import { createServices, type ServicesFactory } from "../../services";
import { createApiKeyRoutes } from "./api-keys";
import { createAdminEventRoutes } from "./events";
import { createAdminCandidateRoutes } from "./candidates";
export function createAdminRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "admin", adapter: CloudflareAdapter })
    .use(createApiKeyRoutes(env, servicesFactory))
    .use(createAdminEventRoutes(env, servicesFactory))
    .use(createAdminCandidateRoutes(env, servicesFactory));
}
