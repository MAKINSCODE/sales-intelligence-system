import "dotenv/config";
import { execSync } from "node:child_process";
import pg from "pg";

export const TEST_DB_NAME = "sales_intel_test";

export function testDatabaseUrl() {
  const base = process.env.DEV_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  url.search = "";
  return url.toString();
}

// Idempotent: creates the dedicated test database if needed and applies all migrations.
export async function ensureTestDatabase() {
  const admin = new URL(testDatabaseUrl());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_database where datname = $1", [TEST_DB_NAME]);
    if (found.rowCount === 0) await client.query(`create database ${TEST_DB_NAME}`);
  } finally {
    await client.end();
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: testDatabaseUrl() }, stdio: "pipe" });
}
