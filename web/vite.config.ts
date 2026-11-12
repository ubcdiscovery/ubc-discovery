import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  plugins: lazyPlugins(() => [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      auxiliaryWorkers: [{ configPath: "../workers/extraction/wrangler.jsonc", devOnly: true }],
    }),
    tailwindcss(),
    reactRouter(),
  ]),
  resolve: {
    tsconfigPaths: true,
  },
});
