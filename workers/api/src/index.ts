import { env } from "cloudflare:workers";
import { createApp } from "./app";

const app = createApp(env);

export default {
  fetch(request) {
    return app.fetch(request);
  },
} satisfies ExportedHandler<CloudflareBindings>;
