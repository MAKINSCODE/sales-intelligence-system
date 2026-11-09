import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

// Opt-in tests that call real APIs against your running dev server and dev database.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /live-.*\.spec\.ts/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/live-setup.ts",
  globalTeardown: "./e2e/live-teardown.ts",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } }],
});
