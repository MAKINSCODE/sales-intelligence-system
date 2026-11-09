import "dotenv/config";
import { cleanE2eData, seedAdmin } from "./db";

export default async function liveSetup() {
  await cleanE2eData();
  await seedAdmin();
}
