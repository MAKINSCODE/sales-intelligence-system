import { cleanE2eData } from "./db";

export default async function globalTeardown() {
  await cleanE2eData();
}
