import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "./test-support/test-db";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

// Everything below runs against an isolated database, Redis prefix, dev server and worker,
// with deterministic fake research providers: tests never touch dev data or spend API credits.
const isolated = {
  DATABASE_URL: testDatabaseUrl(),
  REDIS_PREFIX: "jada-sales-intel:e2e",
  RESEARCH_PROVIDERS: "fake",
  APP_URL: BASE,
  INTERNAL_APP_URL: BASE,
  DEV_SHOW_MAGIC_LINK: "true",
  NEXT_DIST_DIR: ".next-e2e",
  OPENAI_API_KEY: "",
  TAVILY_API_KEY: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  RESEARCH_MAX_SECONDS: "60",
};
Object.assign(process.env, isolated);

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /live-.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: { baseURL: BASE, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    {
      command: `npx next dev -p ${PORT}`,
      url: `${BASE}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: isolated,
    },
    {
      command: "npm run worker",
      wait: { stdout: /worker\.ready/ },
      reuseExistingServer: false,
      timeout: 60_000,
      env: isolated,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
});
