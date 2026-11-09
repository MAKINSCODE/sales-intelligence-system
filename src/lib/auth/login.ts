import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { hashToken, newToken } from "@/lib/auth/tokens";

export const SIGN_IN_TTL_MINUTES = 15;
export const INVITE_TTL_MINUTES = 7 * 24 * 60;
const MAX_LINKS_PER_WINDOW = 5;
const WINDOW_MINUTES = 15;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function bootstrapAdminEmails() {
  return env()
    .BOOTSTRAP_ADMIN_EMAILS.split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export async function isRateLimited(userId: string) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  const count = await db.loginToken.count({
    where: { userId, createdAt: { gt: since } },
  });
  return count >= MAX_LINKS_PER_WINDOW;
}

export async function issueLoginLink(userId: string, ttlMinutes: number) {
  const token = newToken();
  await db.loginToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
    },
  });
  return `${env().APP_URL}/auth/verify?token=${encodeURIComponent(token)}`;
}
