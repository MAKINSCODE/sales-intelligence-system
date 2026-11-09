import { ensureTestDatabase } from "../test-support/test-db";
import { cleanE2eData, seedAdmin, seedTeam, withDb } from "./db";

export default async function globalSetup() {
  await ensureTestDatabase();
  // The test database is private to automated tests, so a full reset is safe and keeps runs deterministic.
  await withDb((c) => c.query(`truncate "Claim","Brief","Source","IdentityCandidate","ResearchRun","Lead","TeamProfile","QualificationSettings","CompanyCatalogue","Session","LoginToken","User" cascade`));
  await cleanE2eData();
  await seedAdmin();
  await seedTeam();
}
