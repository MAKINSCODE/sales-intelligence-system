import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { BudgetExceeded } from "./budget";
import { canonicalProfileUrl } from "./policy";
import type { Providers } from "./types";

const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

// A picture is only fetched for a confirmed profile, and is kept so repeat briefs for the same lead cost nothing.
export async function collectPhoto(args: { leadId: string; profile: string | null; providers: Providers }): Promise<void> {
  const { leadId, profile, providers } = args;
  if (!providers.photos || !profile) return;
  try {
    const have = await db.leadPhoto.findUnique({ where: { leadId }, select: { profileId: true, fetchedAt: true } });
    if (have && have.profileId === profile && Date.now() - have.fetchedAt.getTime() < MAX_AGE_MS) return;
    const photo = await providers.photos.fetchPhoto(canonicalProfileUrl(profile));
    if (!photo) return;
    const data = { profileId: profile, data: new Uint8Array(photo.data), contentType: photo.contentType, fetchedAt: new Date() };
    await db.leadPhoto.upsert({ where: { leadId }, create: { leadId, ...data }, update: data });
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) log.warn("run.photo.failed", { err: e });
  }
}
