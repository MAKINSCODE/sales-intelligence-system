import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./queue", () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/qualification/rules";
import { getSettings, saveSettings, settingsSchema } from "@/lib/qualification/settings";
import { identifyPhase, limitsFromEnv, researchPhase } from "./pipeline";
import { approveRun, confirmCandidate, continueWithoutPerson, deleteBrief, overrideDecision, rejectRun, researchAnyway, restartRun, RunError, startRun } from "./runs";
import { fakeProviders } from "./fake-providers";
import { loadRunView } from "./view";
import type { Prisma } from "@/generated/prisma/client";

const providers = fakeProviders();
let userId: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(`truncate "Claim","Brief","Source","IdentityCandidate","ResearchRun","Lead","TeamProfile","CompanyCatalogue","QualificationSettings","Session","LoginToken","User" cascade`);
  userId = (await db.user.create({ data: { email: "qual@example.com", role: "ADMIN", status: "ACTIVE" } })).id;
});

beforeEach(async () => {
  await db.qualificationSettings.deleteMany();
});

afterAll(async () => {
  await db.qualificationSettings.deleteMany();
  await db.$disconnect();
});

const james = { firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov" };

async function makeRun(lead: Partial<Prisma.LeadUncheckedCreateInput> & { firstName: string }, bypass = false) {
  const l = await db.lead.create({ data: { createdById: userId, ...lead } });
  const run = await db.researchRun.create({ data: { leadId: l.id, requestedById: userId, screenBypassed: bypass, limits: limitsFromEnv() } });
  return { lead: l, runId: run.id };
}

const run = (id: string) => db.researchRun.findUniqueOrThrow({ where: { id } });
const claims = (runId: string) => db.claim.findMany({ where: { runId, section: "QUALIFICATION" }, orderBy: { position: "asc" } });
const group = (list: Awaited<ReturnType<typeof claims>>, g: string) => list.filter((c) => (c.detail as { group?: string } | null)?.group === g);
const data = async (id: string) => (await run(id)).decisionData as { rules: { id: string; outcome: string; detail: string }[]; reasons: string[]; competitors: string[]; screenedOnly: boolean; intent: string | null };

// Every lead waits for the person's decision after the checks; this plays the person choosing to proceed.
async function researched(lead: Partial<Prisma.LeadUncheckedCreateInput> & { firstName: string }) {
  const r = await makeRun(lead);
  expect(await identifyPhase(r.runId, providers)).toBe("research");
  await researchPhase(r.runId, providers);
  expect((await run(r.runId)).status).toBe("AWAITING_APPROVAL");
  await approveRun(r.runId, userId);
  await researchPhase(r.runId, providers, { approved: true });
  return r;
}

describe("screening", () => {
  it("stops a personal email before any search, and keeps the rules that fired", async () => {
    const { runId, lead } = await makeRun({ firstName: "Pat", lastName: "Personal", email: "pat@gmail.com", company: "City Bureau" });
    expect(await identifyPhase(runId, providers)).toBe("stop");
    const r = await run(runId);
    expect(r).toMatchObject({ status: "SCREENED_OUT", decision: "DISQUALIFIED", searches: 0, pagesFetched: 0, postRuns: 0 });
    expect((await data(runId)).reasons).toEqual(["Submitted with a personal email address."]);
    expect((await data(runId)).screenedOnly).toBe(true);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");
  });

  it("stops a request for a job or a personal agent, found by reading the enquiry", async () => {
    const job = await makeRun({ ...james, enquiryText: "Hello, I am looking for a job in your team. My CV is attached." });
    expect(await identifyPhase(job.runId, providers)).toBe("stop");
    expect((await data(job.runId)).reasons).toEqual(["The enquiry asks about a job."]);
    const personal = await makeRun({ ...james, enquiryText: "I would like a personal assistant for myself to manage my day." });
    expect(await identifyPhase(personal.runId, providers)).toBe("stop");
    expect((await data(personal.runId)).reasons).toEqual(["The enquiry asks for an agent for personal use."]);
  });

  it("does not screen out a business enquiry or a lead with no email", async () => {
    const a = await makeRun({ ...james, enquiryText: "We want AI agents for our operations." });
    expect(await identifyPhase(a.runId, providers)).toBe("research");
    const b = await makeRun({ firstName: "Sam", lastName: "Ambiguous", company: "Acme" });
    expect(await identifyPhase(b.runId, providers)).toBe("wait");
    expect((await run(b.runId)).status).toBe("AWAITING_CONFIRMATION");
  });

  it("stops an enquiry that does not match what Acme does, before any search", async () => {
    const { runId } = await makeRun({ ...james, enquiryText: "Please send me your price list for office chairs." });
    expect(await identifyPhase(runId, providers)).toBe("stop");
    expect(await run(runId)).toMatchObject({ status: "SCREENED_OUT", decision: "DISQUALIFIED", searches: 0 });
    expect((await data(runId)).reasons.join(" ")).toContain("does not look like something Acme can help with");
  });

  it("researches anyway on request, as a new run that carries on through refreshes", async () => {
    const first = await makeRun({ ...james, email: "james@gmail.com", enquiryText: "We want AI agents." });
    await identifyPhase(first.runId, providers);
    expect((await run(first.runId)).status).toBe("SCREENED_OUT");

    const again = await researchAnyway(first.lead.id, userId);
    expect(again).not.toBe(first.runId);
    expect((await run(again)).screenBypassed).toBe(true);
    if ((await identifyPhase(again, providers)) === "wait") await continueWithoutPerson(again, userId);
    await researchPhase(again, providers);
    const done = await run(again);
    expect(["COMPLETE", "PARTIAL"]).toContain(done.status);
    expect(done.decision).toBe("DISQUALIFIED");

    const refreshed = await startRun(first.lead.id, userId);
    expect((await run(refreshed)).screenBypassed).toBe(true);
  });

  it("builds the brief without stopping for review when the person skips it, and keeps skipping on refresh", async () => {
    const lead = await db.lead.create({ data: { createdById: userId, ...james, enquiryText: "We want to roll out AI agents across the bureau." } });
    const id = await startRun(lead.id, userId, { bypassScreen: true });
    expect((await run(id)).screenBypassed).toBe(true);
    expect(await identifyPhase(id, providers)).toBe("research");
    await researchPhase(id, providers);
    const done = await run(id);
    expect(["COMPLETE", "PARTIAL"]).toContain(done.status);
    expect(done.decision).toBe("QUALIFIED");
    expect((await data(id)).screenedOnly).toBe(false);
    expect((await run(await startRun(lead.id, userId))).screenBypassed).toBe(true);
  });

  it("refuses to research anyway when the lead was not screened out", async () => {
    const { lead, runId } = await makeRun(james);
    await db.researchRun.update({ where: { id: runId }, data: { status: "COMPLETE" } });
    await expect(researchAnyway(lead.id, userId)).rejects.toThrow(RunError);
  });
});

describe("company intel and the decision", () => {
  it("qualifies a large company with a professional email and a target phrase, and shows its evidence", async () => {
    const { runId } = await researched({ ...james, enquiryText: "We want to roll out AI agents across the bureau." });
    const r = await run(runId);
    expect(r.decision).toBe("QUALIFIED");
    const d = await data(runId);
    expect(d.screenedOnly).toBe(false);
    expect(d.rules.map((x) => [x.id, x.outcome])).toEqual([["email", "pass"], ["job", "pass"], ["personal_agent", "pass"], ["keywords", "pass"], ["size", "pass"], ["revenue", "pass"], ["sector", "unknown"]]);

    const list = await claims(runId);
    const company = group(list, "company");
    expect(company.find((c) => c.statement === "About 320 employees (LinkedIn page: City Bureau)")).toMatchObject({ kind: "FACT", quote: "Employees on LinkedIn: 320" });
    const revenue = company.find((c) => c.statement.startsWith("Yearly revenue"));
    expect(revenue).toMatchObject({ statement: "Yearly revenue of about USD 150 million", quote: "annual revenue of USD 150 million" });
    expect(revenue?.sourceId).toBeTruthy();

    const hiring = group(list, "hiring");
    expect(hiring[0]).toMatchObject({ kind: "FACT", detail: { count: 2, titles: ["AI Engineer", "Data Scientist"] } });
    expect(hiring[0].statement).toContain("2 AI-related job postings");

    const sources = await db.source.findMany({ where: { runId, kind: { in: ["COMPANY_PROFILE", "JOB_LISTING"] } } });
    expect(sources.map((s) => s.kind).sort()).toEqual(["COMPANY_PROFILE", "JOB_LISTING"]);
  });

  it("finds peers and only reports their agentic-AI moves", async () => {
    const { runId } = await researched({ ...james, enquiryText: "We want AI agents." });
    const list = await claims(runId);
    expect((await data(runId)).competitors).toEqual(["Gulf Cooling", "Delta District Energy"]);
    expect(((await db.brief.findUniqueOrThrow({ where: { runId } })).content as { partial: string[] }).partial).toEqual([]);
    const moves = group(list, "competitor").filter((c) => c.kind === "FACT");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ statement: "Gulf Cooling announced an AI agent platform for district operations.", eventDate: "2026-09-01" });
    expect(moves[0].quote).toContain("Gulf Cooling announced");
  });

  it("stops a company known to be too small for the person's review, recommending against going on", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, minEmployees: 1000 }, userId);
    const { runId } = await makeRun({ ...james, enquiryText: "We want to roll out AI agents." });
    expect(await identifyPhase(runId, providers)).toBe("research");
    await researchPhase(runId, providers);
    const r = await run(runId);
    expect(r).toMatchObject({ status: "AWAITING_APPROVAL", decision: "DISQUALIFIED" });
    expect((await data(runId)).reasons.join(" ")).toContain("About 320 employees, below the minimum of 1,000");
    expect(r.decisionData).toMatchObject({ thresholds: { minEmployees: 1000 } });
    expect(await db.identityCandidate.count({ where: { runId } })).toBeGreaterThan(0);
    expect((await claims(runId)).length).toBeGreaterThan(0);
    expect(await db.claim.count({ where: { runId, section: { in: ["NOW", "ACTIVITY", "CONNECTIONS", "CONVERSATION"] } } })).toBe(0);
    expect(await db.brief.count({ where: { runId } })).toBe(0);

    await rejectRun(runId, userId);
    expect((await run(runId)).status).toBe("SCREENED_OUT");
  });

  it("always stops for the person's review, even when the lead qualifies, and builds the brief only after they proceed", async () => {
    const { runId } = await makeRun({ ...james, enquiryText: "We want to roll out AI agents." });
    await identifyPhase(runId, providers);
    await researchPhase(runId, providers);
    expect(await run(runId)).toMatchObject({ status: "AWAITING_APPROVAL", decision: "QUALIFIED" });
    expect(await db.brief.count({ where: { runId } })).toBe(0);
    expect(await db.claim.count({ where: { runId, section: "NOW" } })).toBe(0);

    await approveRun(runId, userId);
    await researchPhase(runId, providers, { approved: true });
    expect(["COMPLETE", "PARTIAL"]).toContain((await run(runId)).status);
    expect(await db.brief.count({ where: { runId } })).toBe(1);
  });

  it("fills in the employer from public sources, so a lead with only a name and an enquiry can qualify", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", enquiryText: "We want AI agents." });
    if ((await identifyPhase(runId, providers)) === "wait") await confirmCandidate(runId, userId, (await db.identityCandidate.findFirstOrThrow({ where: { runId } })).id);
    await researchPhase(runId, providers);
    const r = await run(runId);
    expect(r).toMatchObject({ status: "AWAITING_APPROVAL", decision: "QUALIFIED" });
    const email = (await data(runId)).rules.find((x) => x.id === "email");
    expect(email).toMatchObject({ outcome: "pass", detail: expect.stringContaining("employer was found") });
    expect(group(await claims(runId), "company").some((c) => c.statement.startsWith("About 320 employees"))).toBe(true);
  });

  it("holds an identified lead whose company cannot be sized, then continues without repeating the identification work", async () => {
    const profileCalls: string[] = [];
    const noSize = {
      ...providers,
      companies: undefined,
      llm: { structured: async (req: Parameters<typeof providers.llm.structured>[0]) => (req.name === "profile_facts" && profileCalls.push(req.name), providers.llm.structured(req)) },
      search: { ...providers.search, search: async (q: string, o: Parameters<typeof providers.search.search>[1]) => (/employees/.test(q) ? [] : providers.search.search(q, o)) },
    } as typeof providers;
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", enquiryText: "We want AI agents." });
    if ((await identifyPhase(runId, noSize)) === "wait") await confirmCandidate(runId, userId, (await db.identityCandidate.findFirstOrThrow({ where: { runId } })).id);
    await researchPhase(runId, noSize);

    expect(await run(runId)).toMatchObject({ status: "AWAITING_APPROVAL", decision: "NEEDS_REVIEW" });
    const who = await db.claim.findMany({ where: { runId, section: "WHO" } });
    expect(who.some((c) => c.statement === "Chief Executive at City Bureau")).toBe(true);
    expect(await db.claim.count({ where: { runId, section: "NOW" } })).toBe(0);

    await approveRun(runId, userId);
    await researchPhase(runId, noSize, { approved: true });
    const done = await run(runId);
    expect(done.status).toMatch(/COMPLETE|PARTIAL/);
    expect(profileCalls).toHaveLength(1);
    expect(await db.claim.count({ where: { runId, section: "WHO", statement: "Chief Executive at City Bureau" } })).toBe(1);
    expect(await db.claim.count({ where: { runId, section: "NOW" } })).toBeGreaterThan(0);
    expect(await db.brief.count({ where: { runId } })).toBe(1);
  });

  it("qualifies on headcount alone when revenue cannot be found", async () => {
    const noRevenue = { ...providers, search: { ...providers.search, search: async (q: string, o: Parameters<typeof providers.search.search>[1]) => (/employees/.test(q) ? [] : providers.search.search(q, o)) } };
    const { runId } = await makeRun({ ...james, enquiryText: "We want to roll out AI agents." });
    expect(await identifyPhase(runId, noRevenue)).toBe("research");
    await researchPhase(runId, noRevenue);
    expect((await run(runId)).decision).toBe("QUALIFIED");
    expect((await data(runId)).rules.find((x) => x.id === "revenue")?.outcome).toBe("unknown");
  });

  it("keeps the company evidence through identification and research, and does not repeat the checks", async () => {
    const { runId } = await researched({ ...james, enquiryText: "We want AI agents." });
    const list = await claims(runId);
    expect(group(list, "company").length).toBeGreaterThan(0);
    expect(list.filter((c) => c.statement.startsWith("About 320 employees"))).toHaveLength(1);
    expect(await db.source.count({ where: { runId, kind: "COMPANY_PROFILE" } })).toBe(1);
    expect((await run(runId)).postRuns).toBeGreaterThanOrEqual(2);
  });

  it("never invents what it could not find, and waits for a person to approve", async () => {
    const { runId } = await makeRun({ firstName: "Jamaica", company: "Sandbox Holdings", email: "j@sandbox.example", enquiryText: "We need AI agents." });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    expect(await run(runId)).toMatchObject({ status: "AWAITING_CONFIRMATION" });
    await continueWithoutPerson(runId, userId);
    await researchPhase(runId, providers);
    expect(await run(runId)).toMatchObject({ status: "AWAITING_APPROVAL", decision: "NEEDS_REVIEW" });
    expect(await db.claim.count({ where: { runId, section: "NOW" } })).toBe(0);

    await approveRun(runId, userId);
    expect((await run(runId)).status).toBe("QUEUED");
    await researchPhase(runId, providers, { approved: true });
    const list = await claims(runId);
    expect(group(list, "company").map((c) => c.kind)).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
    expect(group(list, "hiring")[0].kind).toBe("UNAVAILABLE");
    expect((await run(runId)).decision).toBe("NEEDS_REVIEW");
  });

  it("lets a person reject a lead that was waiting, which can still be researched anyway", async () => {
    const { runId, lead } = await makeRun({ firstName: "Jamaica", company: "Sandbox Holdings", email: "j@sandbox.example", enquiryText: "We need AI agents." });
    await identifyPhase(runId, providers);
    await continueWithoutPerson(runId, userId);
    await researchPhase(runId, providers);
    await rejectRun(runId, userId);
    expect(await run(runId)).toMatchObject({ status: "SCREENED_OUT" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");
    await expect(rejectRun(runId, userId)).rejects.toThrow(RunError);
    await expect(approveRun(runId, userId)).rejects.toThrow(RunError);
    expect((await run(await researchAnyway(lead.id, userId))).screenBypassed).toBe(true);
  });

  it("recognises a professional-services exception from the sources", async () => {
    const { runId } = await makeRun({ ...james, enquiryText: "We want AI agents for our matters." });
    const lawProviders = { ...providers, companies: undefined, jobs: undefined, search: { ...providers.search, search: async (q: string, o: Parameters<typeof providers.search.search>[1]) => (/employees/.test(q) ? [{ id: "l1", url: "https://example.org/citybureau/law", title: "City Bureau profile", snippet: "City Bureau is a boutique law firm.", score: 1, publishedDate: null }] : providers.search.search(q, o)) } };
    await identifyPhase(runId, lawProviders);
    await researchPhase(runId, lawProviders);
    const r = await run(runId);
    expect(r.decision).toBe("QUALIFIED");
    expect((await data(runId)).reasons[0]).toContain("exception");
  });
});

describe("overriding the recommendation", () => {
  async function finished() {
    const r = await makeRun({ ...james, enquiryText: "We need AI automation." }, true);
    expect(await identifyPhase(r.runId, providers)).toBe("research");
    await researchPhase(r.runId, providers);
    expect((await run(r.runId)).decision).toBe("NEEDS_REVIEW");
    return r.runId;
  }

  it("stores the person's decision with a reason and keeps the system's", async () => {
    const id = await finished();
    await overrideDecision(id, userId, "QUALIFIED", "  Strong fit despite the wording ");
    expect(await run(id)).toMatchObject({ decision: "NEEDS_REVIEW", overrideDecision: "QUALIFIED", overrideNote: "Strong fit despite the wording", overriddenById: userId });
    await overrideDecision(id, userId, null, null);
    expect(await run(id)).toMatchObject({ decision: "NEEDS_REVIEW", overrideDecision: null, overrideNote: null });
  });

  it("requires a reason, a real change, and a finished brief", async () => {
    const id = await finished();
    await expect(overrideDecision(id, userId, "QUALIFIED", " ")).rejects.toThrow(/reason/);
    await expect(overrideDecision(id, userId, "NEEDS_REVIEW", "same")).rejects.toThrow(/already the recommendation/);
    const { runId } = await makeRun(james);
    await expect(overrideDecision(runId, userId, "QUALIFIED", "because")).rejects.toThrow(RunError);
  });

  it("is private to the person who requested the run", async () => {
    const id = await finished();
    const other = await db.user.create({ data: { email: "other-qual@example.com", status: "ACTIVE" } });
    await expect(overrideDecision(id, other.id, "QUALIFIED", "mine now")).rejects.toThrow("Run not found.");
  });
});

describe("details found online", () => {
  it("fills in the employer and role from the person's LinkedIn profile, so a bare lead can be judged on its company", async () => {
    const fetchProfile = vi.fn(providers.profiles!.fetchProfile.bind(providers.profiles));
    const wrapped = { ...providers, profiles: { fetchProfile } };
    const { runId, lead } = await makeRun({ firstName: "Quinn", lastName: "Profile", profileUrl: "https://www.linkedin.com/in/quinn-profile", enquiryText: "We want AI agents." });
    if ((await identifyPhase(runId, wrapped)) === "wait") await confirmCandidate(runId, userId, (await db.identityCandidate.findFirstOrThrow({ where: { runId } })).id);
    await researchPhase(runId, wrapped);

    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(await run(runId)).toMatchObject({ status: "AWAITING_APPROVAL", decision: "QUALIFIED" });
    const current = await db.claim.findFirstOrThrow({ where: { runId, section: "WHO", detail: { path: ["group"], equals: "current" } } });
    expect(current.statement).toBe("Head of Growth at City Bureau");
    expect(current.detail).toMatchObject({ title: "Head of Growth", organisation: "City Bureau" });
    const source = await db.source.findUniqueOrThrow({ where: { id: current.sourceId! } });
    expect(source).toMatchObject({ kind: "PAGE", domain: "linkedin.com" });
    expect(source.text).toContain("Current role: Head of Growth at City Bureau");

    const view = await loadRunView(lead.id, userId);
    expect(view?.found).toMatchObject({ company: "City Bureau", jobTitle: "Head of Growth", country: "London, United Kingdom" });
  });

  it("does not fetch a profile that nobody confirmed is theirs", async () => {
    const fetchProfile = vi.fn(providers.profiles!.fetchProfile.bind(providers.profiles));
    const wrapped = { ...providers, profiles: { fetchProfile } };
    const { runId } = await makeRun({ firstName: "Sam", lastName: "Ambiguous", company: "Acme" });
    await identifyPhase(runId, wrapped);
    const [first] = await db.identityCandidate.findMany({ where: { runId } });
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: first.id, identityConfirmed: false, status: "QUEUED" } });
    await researchPhase(runId, wrapped);
    expect(fetchProfile).not.toHaveBeenCalled();
  });

  it("searches once more for the employer only when none is known from the lead or the sources", async () => {
    const queries: string[] = [];
    const spy = { ...providers, search: { ...providers.search, search: async (q: string, o: Parameters<typeof providers.search.search>[1]) => (queries.push(q), providers.search.search(q, o)) } };
    const bare = await makeRun({ firstName: "Zed", lastName: "Plain" });
    await identifyPhase(bare.runId, spy);
    await db.researchRun.update({ where: { id: bare.runId }, data: { selectedCandidateId: (await db.identityCandidate.findFirstOrThrow({ where: { runId: bare.runId } })).id, identityConfirmed: true, status: "QUEUED" } });
    await researchPhase(bare.runId, spy);
    expect(queries.some((q) => q.includes("current job title company"))).toBe(true);

    queries.length = 0;
    const known = await makeRun({ firstName: "Zed", lastName: "Plain", company: "Acme" });
    await identifyPhase(known.runId, spy);
    await db.researchRun.update({ where: { id: known.runId }, data: { selectedCandidateId: (await db.identityCandidate.findFirstOrThrow({ where: { runId: known.runId } })).id, identityConfirmed: true, status: "QUEUED" } });
    await researchPhase(known.runId, spy);
    expect(queries.some((q) => q.includes("current job title company"))).toBe(false);
  });
});

describe("restarting and deleting a brief", () => {
  it("restarts from any state: the waiting run is stopped and a fresh one is queued", async () => {
    const { runId, lead } = await makeRun({ firstName: "Sam", lastName: "Ambiguous", company: "Acme" });
    await identifyPhase(runId, providers);
    expect((await run(runId)).status).toBe("AWAITING_CONFIRMATION");
    const fresh = await restartRun(lead.id, userId);
    expect(fresh).not.toBe(runId);
    expect((await run(runId)).status).toBe("CANCELLED");
    expect((await run(fresh)).status).toBe("QUEUED");
  });

  it("deletes every run, claim and source of the lead, which goes back to new, and only for its owner", async () => {
    const { runId, lead } = await researched({ ...james, enquiryText: "We want AI agents." });
    await db.lead.update({ where: { id: lead.id }, data: { status: "READY" } });
    const other = await db.user.create({ data: { email: "del-other@example.com", status: "ACTIVE" } });
    await expect(deleteBrief(lead.id, other.id)).rejects.toThrow(RunError);
    expect(await db.researchRun.count({ where: { id: runId } })).toBe(1);

    await deleteBrief(lead.id, userId);
    expect(await db.researchRun.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await db.claim.count({ where: { runId } })).toBe(0);
    expect(await db.source.count({ where: { runId } })).toBe(0);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");
  });
});

describe("qualification settings", () => {
  it("accepts empty optional lists, trims and de-duplicates, and requires a target phrase and numbers", () => {
    const ok = settingsSchema.parse({ minEmployees: "50", minRevenueUsdM: "20", strongKeywords: " ai agents \n\nAI agents, fdes\r\nai agents", weakKeywords: "", exceptionSectors: "" });
    expect(ok).toEqual({ minEmployees: 50, minRevenueUsdM: 20, strongKeywords: ["ai agents", "AI agents", "fdes"], weakKeywords: [], exceptionSectors: [] });
    expect(settingsSchema.safeParse({ ...ok, strongKeywords: "" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, minEmployees: "" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, minRevenueUsdM: "-5" }).success).toBe(false);
  });

  it("falls back to defaults until an admin saves, then returns what was saved", async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ minEmployees: 50, minRevenueUsdM: 20, strongKeywords: ["ai agents"], weakKeywords: [], exceptionSectors: ["law firm"] }, userId);
    expect(await getSettings()).toEqual({ minEmployees: 50, minRevenueUsdM: 20, strongKeywords: ["ai agents"], weakKeywords: [], exceptionSectors: ["law firm"] });
  });
});
