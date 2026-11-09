import { createHash, randomBytes } from "node:crypto";

// Tokens are 256-bit random values, so an unsalted SHA-256 is sufficient for lookup.
export const newToken = () => randomBytes(32).toString("base64url");

export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
