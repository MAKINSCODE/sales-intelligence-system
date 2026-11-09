import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { canonicalProfileUrl, linkedinProfileId } from "@/lib/research/policy";
import { fromRow, type ProfileForm } from "./profile";

export const MAX_TEAM_PROFILES = 25;

export type AddResult = { added: string[]; existing: string[]; invalid: string[]; overLimit: boolean };

// Accepts addresses separated by whitespace, commas or semicolons; a bare "linkedin.com/in/x" is allowed.
export function parseProfileUrls(text: string) {
  const valid = new Map<string, string>();
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const id = linkedinProfileId(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!id) invalid.push(raw.slice(0, 120));
    else valid.set(id, canonicalProfileUrl(id));
  }
  return { urls: [...valid.values()], invalid };
}

export async function addTeamProfiles(text: string, adminId: string): Promise<AddResult> {
  const { urls, invalid } = parseProfileUrls(text);
  const result: AddResult = { added: [], existing: [], invalid, overLimit: false };
  for (const linkedinUrl of urls) {
    if (await db.teamProfile.findUnique({ where: { linkedinUrl }, select: { id: true } })) {
      result.existing.push(linkedinUrl);
      continue;
    }
    if ((await db.teamProfile.count()) >= MAX_TEAM_PROFILES) {
      result.overLimit = true;
      break;
    }
    await db.teamProfile.create({ data: { linkedinUrl, addedById: adminId } });
    result.added.push(linkedinUrl);
  }
  log.info("team.profiles_added", { added: result.added.length, existing: result.existing.length, invalid: invalid.length });
  return result;
}

export async function removeTeamProfile(id: string) {
  const { count } = await db.teamProfile.deleteMany({ where: { id } });
  log.info("team.profile_removed", { removed: count });
}

// The worker picks queued profiles up within seconds; one that is being fetched right now is left alone.
export async function requestRefresh(id?: string) {
  const { count } = await db.teamProfile.updateMany({ where: { ...(id ? { id } : {}), status: { not: "REFRESHING" } }, data: { status: "PENDING", error: null } });
  log.info("team.refresh_requested", { count, all: !id });
  return count;
}

export const listTeamProfiles = () => db.teamProfile.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });

export type TeamMember = { id: string; name: string; linkedinUrl: string; profile: ProfileForm };

// A profile is usable as soon as it has been read once; a later failed refresh keeps the last good copy.
export async function loadTeam(): Promise<TeamMember[]> {
  const rows = await db.teamProfile.findMany({ where: { lastRefreshedAt: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r) => {
    const profile = fromRow(r);
    return { id: r.id, name: profile.fullName || "Team member", linkedinUrl: r.linkedinUrl, profile };
  });
}
