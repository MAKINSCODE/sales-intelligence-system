import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { fakeProfileProvider } from "./fake";
import { refreshDue, refreshProfile } from "./refresh";
import { addTeamProfiles, loadTeam, removeTeamProfile, requestRefresh } from "./service";
import { type ProfileProvider } from "./scrape";

const DAY = 86_400_000;
const url = (slug: string) => `https://www.linkedin.com/in/${slug}`;
const fake = fakeProfileProvider();

let adminId: string;

beforeEach(async () => {
  await db.$executeRawUnsafe(`truncate "TeamProfile","User" cascade`);
  adminId = (await db.user.create({ data: { email: "team-admin@example.com", role: "ADMIN", status: "ACTIVE" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const row = (slug: string) => db.teamProfile.findUniqueOrThrow({ where: { linkedinUrl: url(slug) } });

describe("team list", () => {
  it("adds new profiles as pending, skips duplicates and reports invalid addresses", async () => {
    const first = await addTeamProfiles("https://www.linkedin.com/in/piero-trivellato https://www.linkedin.com/company/x", adminId);
    expect(first).toMatchObject({ added: [url("piero-trivellato")], existing: [], invalid: ["https://www.linkedin.com/company/x"] });
    const again = await addTeamProfiles("linkedin.com/in/Piero-Trivellato/", adminId);
    expect(again.added).toEqual([]);
    expect(again.existing).toEqual([url("piero-trivellato")]);
    expect((await row("piero-trivellato")).status).toBe("PENDING");
    expect(await loadTeam()).toEqual([]);
  });

  it("removes a profile, and it is no longer used", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/piero-trivellato", adminId);
    const { id } = await row("piero-trivellato");
    await refreshProfile(id, fake);
    expect((await loadTeam()).map((m) => m.name)).toEqual(["Piero Trivellato"]);
    await removeTeamProfile(id);
    expect(await loadTeam()).toEqual([]);
  });
});

describe("refreshProfile", () => {
  it("stores what was read and makes the profile usable", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/piero-trivellato", adminId);
    const { id } = await row("piero-trivellato");
    expect(await refreshProfile(id, fake)).toBe("refreshed");
    const r = await row("piero-trivellato");
    expect(r).toMatchObject({ status: "READY", error: null, fullName: "Piero Trivellato", headline: "Managing Director" });
    expect(r.lastRefreshedAt).toBeInstanceOf(Date);
    const [m] = await loadTeam();
    expect(m.profile.education[0].institution).toBe("Westfield University");
    expect(m.profile.homeBase).toBe("Lagos, Nigeria");
  });

  it("records a failure for an unreadable profile, and a failed refresh keeps the last good copy in use", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/missing-person https://www.linkedin.com/in/piero-trivellato", adminId);
    const missing = await row("missing-person");
    expect(await refreshProfile(missing.id, fake)).toBe("failed");
    expect(await row("missing-person")).toMatchObject({ status: "FAILED", error: "No profile data was returned for that address." });
    expect(await loadTeam()).toEqual([]);

    const good = await row("piero-trivellato");
    await refreshProfile(good.id, fake);
    const broken: ProfileProvider = { fetchProfile: async () => { throw new Error("socket exploded with secret-token"); } };
    expect(await refreshProfile(good.id, broken)).toBe("failed");
    const after = await row("piero-trivellato");
    expect(after.status).toBe("FAILED");
    expect(after.error).toBe("The profile could not be read. Try again later.");
    expect((await loadTeam()).map((m) => m.name)).toEqual(["Piero Trivellato"]);
  });

  it("does not fetch a profile that is already being read", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/piero-trivellato", adminId);
    const { id } = await row("piero-trivellato");
    await db.teamProfile.update({ where: { id }, data: { status: "REFRESHING" } });
    const provider = { fetchProfile: vi.fn() };
    expect(await refreshProfile(id, provider)).toBe("skipped");
    expect(provider.fetchProfile).not.toHaveBeenCalled();
    expect(await requestRefresh(id)).toBe(0);
  });
});

describe("refreshDue", () => {
  const set = (slug: string, data: Record<string, unknown>) => db.teamProfile.update({ where: { linkedinUrl: url(slug) }, data });

  it("reads pending profiles, re-reads weekly, retries failures later, and recovers stuck ones", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/pending-one https://www.linkedin.com/in/fresh-one https://www.linkedin.com/in/stale-one https://www.linkedin.com/in/failed-recent https://www.linkedin.com/in/failed-old https://www.linkedin.com/in/stuck-one", adminId);
    const now = new Date();
    const ago = (ms: number) => new Date(now.getTime() - ms);
    await set("fresh-one", { status: "READY", lastRefreshedAt: ago(DAY) });
    await set("stale-one", { status: "READY", lastRefreshedAt: ago(8 * DAY) });
    await set("failed-recent", { status: "FAILED", updatedAt: ago(60_000) });
    await set("failed-old", { status: "FAILED", updatedAt: ago(7 * 3_600_000) });
    await set("stuck-one", { status: "REFRESHING", updatedAt: ago(30 * 60_000) });

    const provider = { fetchProfile: vi.fn((u: string) => fake.fetchProfile(u)) };
    expect(await refreshDue(provider, now)).toBe(4);
    const fetched = provider.fetchProfile.mock.calls.map(([u]) => u.slice(u.lastIndexOf("/") + 1)).sort();
    expect(fetched).toEqual(["failed-old", "pending-one", "stale-one", "stuck-one"]);
    expect((await row("fresh-one")).lastRefreshedAt!.getTime()).toBeLessThan(now.getTime() - DAY / 2);
    expect((await row("failed-recent")).status).toBe("FAILED");
  });

  it("keeps going when one profile fails", async () => {
    await addTeamProfiles("https://www.linkedin.com/in/missing-person https://www.linkedin.com/in/ok-person", adminId);
    expect(await refreshDue(fake)).toBe(2);
    expect((await row("ok-person")).status).toBe("READY");
    expect((await row("missing-person")).status).toBe("FAILED");
  });
});
