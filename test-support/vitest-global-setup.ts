import { ensureTestDatabase } from "./test-db";

export default async function setup() {
  await ensureTestDatabase();
}
