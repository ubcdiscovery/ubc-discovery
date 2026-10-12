import { defineConfig, devices } from "@playwright/test";
import { loadLiveFixture } from "./live-e2e/support/fixtures";

const live = loadLiveFixture();
export default defineConfig({
  testDir: "./live-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: live.webBaseUrl,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    // Requests contain real ID tokens. Do not persist traces, videos, screenshots,
    // or authentication state in ordinary test artifacts.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "live-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "live-mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
  ],
});
