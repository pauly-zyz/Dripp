import { defineConfig, devices } from "@playwright/test";

/**
 * UI tests against a running local stack (scripts/e2e-local.sh with E2E_KEEP=1) and `next start`.
 * WEB_URL defaults to http://127.0.0.1:3000. Uses the preinstalled Chromium when CHROMIUM_PATH is set.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "../.e2e/playwright",
  use: {
    baseURL: process.env.WEB_URL ?? "http://127.0.0.1:3000",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 }, browserName: "chromium" } },
  ],
});
