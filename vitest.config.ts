import "dotenv/config";
import { testDatabaseUrl } from "./test-support/test-db";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    // Database tests truncate shared tables, so files must not run at the same time.
    fileParallelism: false,
    globalSetup: ["./test-support/vitest-global-setup.ts"],
    env: { DATABASE_URL: testDatabaseUrl() },
  },
});
