import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Workers AI only runs remotely. End-to-end tests mock the API and have no
      // Cloudflare credentials in CI, so they run without remote bindings.
      remoteBindings: process.env.CLOUDFLARE_REMOTE_BINDINGS !== "false",
      auxiliaryWorkers: [{ configPath: "../workers/extraction/wrangler.jsonc", devOnly: true }],
    }),
    tailwindcss(),
    reactRouter(),
  ]),
  resolve: {
    tsconfigPaths: true,
  },
});
