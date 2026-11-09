import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { ProviderNotConfigured } from "@/lib/research/providers";
import { toStored } from "./profile";
import { ProfileFetchError, type ProfileProvider } from "./scrape";

const DAY = 86_400_000;
const REFRESH_EVERY_MS = 7 * DAY;
const RETRY_FAILED_AFTER_MS = 6 * 3_600_000;
const STUCK_AFTER_MS = 10 * 60_000;
const BATCH = 10;

export type RefreshOutcome = "refreshed" | "failed" | "skipped";

// Only the profile's own failure text is shown to admins; anything else is reported generically.
const reason = (e: unknown) => (e instanceof ProfileFetchError || e instanceof ProviderNotConfigured ? e.message : "The profile could not be read. Try again later.");

export async function refreshProfile(id: string, provider: ProfileProvider): Promise<RefreshOutcome> {
  const claimed = await db.teamProfile.updateMany({ where: { id, status: { not: "REFRESHING" } }, data: { status: "REFRESHING" } });
  if (claimed.count === 0) return "skipped";
  const row = await db.teamProfile.findUnique({ where: { id }, select: { linkedinUrl: true } });
  if (!row) return "skipped";

  const start = Date.now();
  try {
    const profile = await provider.fetchProfile(row.linkedinUrl);
    const stored = toStored(profile);
    await db.teamProfile.updateMany({
      where: { id },
      data: {
        fullName: profile.fullName,
        headline: profile.headline,
        summary: profile.summary,
        education: stored.education as Prisma.InputJsonValue,
        employment: stored.employment as Prisma.InputJsonValue,
        locations: stored.locations as Prisma.InputJsonValue,
        expertise: profile.expertise,
        status: "READY",
        error: null,
        lastRefreshedAt: new Date(),
      },
    });
    log.info("team.profile_refreshed", { id, ms: Date.now() - start, jobs: profile.employment.length, schools: profile.education.length });
    return "refreshed";
  } catch (e) {
    log.error("team.profile_refresh_failed", { id, ms: Date.now() - start, err: e });
    await db.teamProfile.updateMany({ where: { id }, data: { status: "FAILED", error: reason(e) } });
    return "failed";
  }
}

// Called on a timer by the worker: new and manually requested profiles right away, everything else weekly.
export async function refreshDue(provider: ProfileProvider, now = new Date()): Promise<number> {
  await db.teamProfile.updateMany({ where: { status: "REFRESHING", updatedAt: { lt: new Date(now.getTime() - STUCK_AFTER_MS) } }, data: { status: "PENDING" } });

  const due = await db.teamProfile.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "READY", lastRefreshedAt: { lt: new Date(now.getTime() - REFRESH_EVERY_MS) } },
        { status: "FAILED", updatedAt: { lt: new Date(now.getTime() - RETRY_FAILED_AFTER_MS) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    select: { id: true },
  });
  let done = 0;
  for (const { id } of due) if ((await refreshProfile(id, provider)) !== "skipped") done++;
  return done;
}
