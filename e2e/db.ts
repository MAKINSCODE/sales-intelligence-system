import "dotenv/config";
import pg from "pg";

export const E2E_ADMIN = "e2e-admin@example.com";

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function resetLoginTokens(email: string) {
  await withDb((c) => c.query(`delete from "LoginToken" where "userId" in (select id from "User" where email = $1)`, [email]));
}

const OWNED = `(select id from "User" where email like 'e2e-%')`;

// Removes only e2e-* users and everything they own, so it is safe against a shared dev database.
export async function cleanE2eData() {
  await withDb(async (c) => {
    await c.query(`delete from "ResearchRun" where "requestedById" in ${OWNED}`);
    await c.query(`delete from "Lead" where "createdById" in ${OWNED}`);
    await c.query(`delete from "User" where email like 'e2e-%'`);
  });
}

export async function seedAdmin() {
  await withDb((c) =>
    c.query(`insert into "User" (id, email, role, status, "createdAt", "lastLoginAt") values ('e2e-admin-id', $1, 'ADMIN', 'ACTIVE', now(), now())`, [E2E_ADMIN]),
  );
}

// Already-read profiles, so a brief never waits on the background refresh. They match the fake profile provider's data.
export async function seedTeam() {
  const osun = JSON.stringify([{ institution: "Osun State University", qualification: null, start: "2021", end: "2025", location: "Osogbo, Nigeria" }]);
  const gulf = JSON.stringify([{ organisation: "Gulf Utilities", title: "Account Manager", start: "2019", end: "2022", location: "Dubai, United Arab Emirates", workMode: "onsite", regionServed: null }]);
  await withDb(async (c) => {
    const q = `insert into "TeamProfile" (id, "linkedinUrl", "fullName", education, employment, status, "lastRefreshedAt", "createdAt", "updatedAt") values ($1, $2, $3, $4, $5, 'READY', now(), $6, now())`;
    await c.query(q, ["e2e-team-1", "https://www.linkedin.com/in/piero-trivellato", "Piero Trivellato", osun, "[]", "2026-01-01"]);
    await c.query(q, ["e2e-team-2", "https://www.linkedin.com/in/azeez-busari-262a81a1", "Azeez Busari", "[]", gulf, "2026-01-02"]);
  });
}

// A lead without a surname, which the form no longer accepts but older records can still be.
export async function seedSurnamelessLead(fields: { firstName: string; email?: string; enquiryText?: string }) {
  const id = `e2e-lead-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await withDb((c) =>
    c.query(`insert into "Lead" (id, "firstName", email, "enquiryText", "createdById", "updatedAt") values ($1, $2, $3, $4, 'e2e-admin-id', now())`, [id, fields.firstName, fields.email ?? null, fields.enquiryText ?? null]),
  );
  return id;
}
