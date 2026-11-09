import { cleanE2eData } from "./db";

export default async function liveTeardown() {
  await cleanE2eData();
}
