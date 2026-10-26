import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import type { ApiEnv } from "../../env";
import { createServices, type ServicesFactory } from "../../services";
import { createDeliveryRoutes } from "./delivery";
import { createRecoveryRoutes } from "./recovery";

export { settledStatus } from "./candidates";

export function createExtractionRoutes(
  env: ApiEnv,
  servicesFactory: ServicesFactory = () => createServices(env),
) {
  return new Elysia({ name: "queue-extraction", adapter: CloudflareAdapter })
    .use(createDeliveryRoutes(env, servicesFactory))
    .use(createRecoveryRoutes(env, servicesFactory));
}
