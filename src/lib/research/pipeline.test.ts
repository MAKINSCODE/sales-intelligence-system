import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./queue", () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { identifyPhase, researchPhase, limitsFromEnv } from "./pipeline";
import { POSTS_NO_PROFILE, POSTS_NOT_MATCHED } from "./activity";
import { cancelRun, confirmCandidate, continueWithoutPerson, RunError, startRun } from "./runs";
import { enqueue } from "./queue";
import { fakeProviders, FAKE_PHOTO } from "./fake-providers";
import type { Providers } from "./types";
import type { Prisma } from "@/generated/prisma/client";

const providers = fakeProviders();
let userId: string;
let catalogueId: string;

const member = (fullName: string, slug: string, createdAt: string, extra: Partial<Prisma.TeamProfileCreateInput> = {}) =>
  db.teamProfile.create({
    data: { linkedinUrl: `https://www.linkedin.com/in/${slug}`, fullName, status: "READY", lastRefreshedAt: new Date(), createdAt: new Date(createdAt), education: [], employment: [], locations: [], expertise: [], ...extra },
  });

const seedTeam = async () => {
  await member("Alex Johnson", "alex-johnson", "2026-01-01", { education: [{ institution: "Westfield University", qualification: null, start: "2021", end: "2025", location: "Springfield, OH" }], locations: [{ place: "Denver, CO", basis: "stated_home_base" }] });
  await member("Sam Torres", "sam-torres", "2026-01-02", { employment: [{ organisation: "Apex Utilities", title: null, start: "2019", end: "2022", location: null, workMode: "unknown", regionServed: null }] });
};

beforeAll(async () => {
  await db.$executeRawUnsafe(`truncate "Claim","Brief","Source","IdentityCandidate","ResearchRun","Lead","TeamProfile","CompanyCatalogue","Session","LoginToken","User" cascade`);
  userId = (await db.user.create({ data: { email: "it@example.com", role: "ADMIN", status: "ACTIVE" } })).id;
  await seedTeam();
  catalogueId = (
    await db.companyCatalogue.create({
      data: { version: "t", contentHash: "t", approved: true, approvedBy: "Tester", isActive: true, data: { company: { name: "Acme" }, solutions: [{ id: "salespro", kind: "agent_case_study", name: "SalesPro AI Agent", summary: "Profiles", claims: [] }], excluded: [], handlingRules: [], differentiators: [] } },
    })
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => vi.clearAllMocks());

// These tests are about research itself, so the qualification gate is bypassed unless a test is about the gate.
async function makeRun(lead: Partial<Prisma.LeadUncheckedCreateInput> & { firstName: string }, opts: { limits?: Partial<ReturnType<typeof limitsFromEnv>>; forMemberId?: string } = {}) {
  const l = await db.lead.create({ data: { createdById: userId, ...lead } });
  const run = await db.researchRun.create({
    data: { leadId: l.id, requestedById: userId, catalogueId, screenBypassed: true, forMemberId: opts.forMemberId, limits: { ...limitsFromEnv(), ...opts.limits } },
  });
  return { lead: l, runId: run.id };
}

const status = async (id: string) => db.researchRun.findUniqueOrThrow({ where: { id } });
const claims = (runId: string, section?: string) => db.claim.findMany({ where: { runId, ...(section ? { section: section as never } : {}) }, orderBy: { position: "asc" } });

describe("full pipeline", () => {
  it("identifies a clear match, builds a sourced brief with potential connections, and keeps the activity section honest", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov", enquiryText: "We want an AI agent to support our operational and executive functions across the bureau." });
    expect(await identifyPhase(runId, providers)).toBe("research");
    await researchPhase(runId, providers);

    const run = await status(runId);
    expect(run.status).toBe("COMPLETE");
    expect(run.searches).toBeGreaterThan(0);
    expect(run.llmCalls).toBeGreaterThan(0);

    const who = await claims(runId, "WHO");
    const role = who.find((c) => c.detail && (c.detail as { group?: string }).group === "current");
    expect(role?.statement).toBe("Chief Executive at City Bureau");
    expect(role?.quote).toContain("is the Chief Executive of City Bureau");
    expect(role?.sourceId).toBeTruthy();

    const connections = await claims(runId, "CONNECTIONS");
    const osun = connections.find((c) => c.statement === "Alex Johnson also studied at Westfield University");
    expect(osun).toMatchObject({ kind: "POTENTIAL" });
    expect(JSON.stringify(osun!.detail)).toContain("may have been there at the same time");
    expect(osun!.detail).toMatchObject({ member: "Alex Johnson", kind: "education" });
    expect(connections.map((c) => c.statement)).toContain("Sam Torres also worked at Apex Utilities");
    expect((await db.brief.findUniqueOrThrow({ where: { runId } })).content).toMatchObject({ connections: { totalLinks: 2, membersWithLinks: 2, teamSize: 2, shown: 2 } });

    const now = await claims(runId, "NOW");
    expect(now.some((c) => c.kind === "FACT" && c.statement.includes("urban transit") && c.eventDate === "2026-03-10")).toBe(true);
    expect(now.some((c) => c.kind === "PROVIDED")).toBe(true);

    const activity = await claims(runId, "ACTIVITY");
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ kind: "UNAVAILABLE", statement: POSTS_NO_PROFILE });

    const hypotheses = await claims(runId, "CONVERSATION");
    expect(hypotheses.length).toBeGreaterThanOrEqual(1);
    expect(hypotheses.every((h) => h.kind === "HYPOTHESIS")).toBe(true);
    expect(hypotheses.some((h) => h.statement.includes("made-up"))).toBe(false);
    expect(hypotheses.filter((h) => (h.detail as { role?: string }).role === "angle")).toHaveLength(1);
    const stated = hypotheses.find((h) => (h.detail as { type?: string }).type === "stated");
    expect((stated?.detail as { solutionName?: string; soWhat?: string }).solutionName).toBe("SalesPro AI Agent");
    expect((stated?.detail as { soWhat?: string }).soWhat).toBeTruthy();
    for (const h of hypotheses) {
      const ids = (h.detail as { basisClaimIds: string[] }).basisClaimIds;
      expect(await db.claim.count({ where: { id: { in: ids }, runId } })).toBe(ids.length);
    }

    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect(brief.content).not.toHaveProperty("opener");
    expect(brief.content).not.toHaveProperty("questions");
    expect((await db.lead.findFirstOrThrow({ where: { runs: { some: { id: runId } } } })).status).toBe("READY");
  });

  it("asks who the brief is for when nobody was chosen, and does not when a teammate was", async () => {
    const ada = await db.teamProfile.findFirstOrThrow({ where: { fullName: "Sam Torres" } });
    const lead = { firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov" };
    const open = await makeRun(lead);
    await identifyPhase(open.runId, providers);
    await researchPhase(open.runId, providers);
    expect(await db.briefMessage.findMany({ where: { runId: open.runId } })).toMatchObject([{ role: "ASSISTANT", content: expect.stringContaining("Who is this brief for?") }]);

    const chosen = await makeRun(lead, { forMemberId: ada.id });
    await identifyPhase(chosen.runId, providers);
    await researchPhase(chosen.runId, providers);
    expect(await db.briefMessage.count({ where: { runId: chosen.runId } })).toBe(0);
    expect(["COMPLETE", "PARTIAL"]).toContain((await status(chosen.runId)).status);
  });

  it("every stored quote really appears in its stored source", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
    await identifyPhase(runId, providers);
    await researchPhase(runId, providers);
    const cited = await db.claim.findMany({ where: { runId, quote: { not: null } }, include: { source: true } });
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) {
      expect(c.source, c.statement).toBeTruthy();
      expect(c.source!.text.toLowerCase().replace(/\s+/g, " ")).toContain(c.quote!.toLowerCase().replace(/\s+/g, " "));
    }
  });

  it("pauses for confirmation when two different people share the name, then continues with the chosen one", async () => {
    const { runId } = await makeRun({ firstName: "Sam", lastName: "Ambiguous" });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    const waiting = await status(runId);
    expect(waiting.status).toBe("AWAITING_CONFIRMATION");
    expect(waiting.selectedCandidateId).toBeNull();

    const candidates = await db.identityCandidate.findMany({ where: { runId } });
    expect(candidates).toHaveLength(2);
    const leeds = candidates.find((c) => c.headline?.includes("Northwind"))!;
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: leeds.id, status: "QUEUED" } });
    await researchPhase(runId, providers);

    const who = (await claims(runId, "WHO")).map((c) => c.statement).join(" | ");
    expect(who).toContain("Finance Director at Northwind Traders");
    expect(who).not.toContain("Contoso");
    expect((await status(runId)).status).toBe("COMPLETE");
  });

  it("cannot go on to research when the person is unidentified, but still yields an honest organisation-level brief", async () => {
    const { runId } = await makeRun({ firstName: "Nobody", lastName: "Found", company: "City Bureau", email: "it@citybureau.example.gov" });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    expect((await db.identityCandidate.count({ where: { runId } }))).toBe(0);

    await researchPhase(runId, providers);
    const run = await status(runId);
    expect(run.unidentified).toBe(true);
    expect(["COMPLETE", "PARTIAL"]).toContain(run.status);
    const who = await claims(runId, "WHO");
    expect(who.some((c) => c.kind === "UNAVAILABLE")).toBe(true);
    expect(who.some((c) => c.kind === "FACT" && (c.detail as { group?: string })?.group === "current")).toBe(false);
    expect((await claims(runId, "NOW")).some((c) => c.kind === "FACT")).toBe(true);
    expect((await claims(runId, "CONNECTIONS"))[0].kind).toBe("UNAVAILABLE");
  });

  it("refuses to research someone with no surname and looks nobody up", async () => {
    const { runId } = await makeRun({ firstName: "Jamaica", email: "it@example-motors.com" });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    const run = await status(runId);
    expect(run.status).toBe("AWAITING_CONFIRMATION");
    expect(run.pagesFetched).toBe(0);
    expect(await db.identityCandidate.count({ where: { runId } })).toBe(0);
    expect(run.stage).toContain("surname");
  });

  it("builds an organisation-level brief for a surname-less lead from the work-email domain and enquiry, without pretending to know the person", async () => {
    const { runId } = await makeRun({ firstName: "Jamaica", email: "it@citybureau.example.gov", enquiryText: "We are looking for an AI assistant for our CEO and company with voice and text support." });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: null, status: "QUEUED" } });
    await researchPhase(runId, providers);

    const run = await status(runId);
    expect(run.unidentified).toBe(true);
    expect(["COMPLETE", "PARTIAL"]).toContain(run.status);
    const who = await claims(runId, "WHO");
    expect(who.some((c) => c.kind === "FACT" && (c.detail as { group?: string } | null)?.group !== "decision_maker")).toBe(false);
    expect(who.some((c) => c.kind === "UNAVAILABLE")).toBe(true);
    const now = await claims(runId, "NOW");
    expect(now.some((c) => c.kind === "FACT" && c.statement.includes("urban transit"))).toBe(true);
    expect(now.some((c) => c.kind === "PROVIDED")).toBe(true);
    const hypotheses = await claims(runId, "CONVERSATION");
    expect(hypotheses.some((h) => (h.detail as { type?: string }).type === "stated")).toBe(true);
  });

  it("does nothing useful but fails safely when there is no company, domain or enquiry at all", async () => {
    const { runId } = await makeRun({ firstName: "Pat", email: "pat@gmail.com" });
    await identifyPhase(runId, providers);
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: null, status: "QUEUED" } });
    await researchPhase(runId, providers);
    expect((await status(runId)).searches).toBe(0);
    expect((await claims(runId, "NOW"))[0].kind).toBe("UNAVAILABLE");
  });

  it("says common ground cannot be checked when no team profile has been read", async () => {
    await db.teamProfile.deleteMany();
    try {
      const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
      await identifyPhase(runId, providers);
      await researchPhase(runId, providers);
      const [c] = await claims(runId, "CONNECTIONS");
      expect(c.kind).toBe("UNAVAILABLE");
      expect(c.statement).toContain("No team LinkedIn profiles");
    } finally {
      await seedTeam();
    }
  });

  it("uses the team list as it is when the run starts, and ignores a profile that has never been read", async () => {
    await member("Pending Person", "pending-person", "2026-01-03", { status: "PENDING", lastRefreshedAt: null, education: [{ institution: "Westfield University", qualification: null, start: "2021", end: "2025", location: null }] });
    try {
      const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
      await identifyPhase(runId, providers);
      await researchPhase(runId, providers);
      const text = (await claims(runId, "CONNECTIONS")).map((c) => c.statement).join(" ");
      expect(text).not.toContain("Pending Person");
      const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
      expect((brief.content as { team: { name: string }[] }).team.map((t) => t.name)).toEqual(["Alex Johnson", "Sam Torres"]);
    } finally {
      await db.teamProfile.deleteMany({ where: { linkedinUrl: { endsWith: "/pending-person" } } });
    }
  });

  it("delivers a labelled partial brief when a model step fails", async () => {
    const { runId } = await makeRun({ firstName: "Fail", lastName: "Case", company: "Acme" });
    expect(await identifyPhase(runId, providers)).toBe("wait");
    const candidate = await db.identityCandidate.findFirstOrThrow({ where: { runId } });
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: candidate.id, status: "QUEUED" } });
    await researchPhase(runId, providers);
    const run = await status(runId);
    expect(run.status).toBe("PARTIAL");
    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect((brief.content as { partial: string[] }).partial.join(" ")).toContain("career details");
    expect((await claims(runId, "ACTIVITY"))).toHaveLength(1);
  });

  it("stops at the search budget and says so instead of looping", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau", email: "j@citybureau.example.gov" }, { limits: { maxSearches: 1 } });
    await identifyPhase(runId, providers);
    await researchPhase(runId, providers);
    const run = await status(runId);
    expect(run.searches).toBe(1);
    expect(run.status).toBe("PARTIAL");
    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect((brief.content as { partial: string[] }).partial.join(" ")).toMatch(/searches limit/);
  });

  it("fails cleanly when the very first search is over budget", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison" }, { limits: { maxSearches: 0 } });
    expect(await identifyPhase(runId, providers)).toBe("stop");
    const run = await status(runId);
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("limit");
  });

  it("does not count time spent waiting for confirmation against the deadline", async () => {
    const { runId } = await makeRun({ firstName: "Sam", lastName: "Ambiguous" }, { limits: { maxSeconds: 30 } });
    await identifyPhase(runId, providers);
    await db.researchRun.update({ where: { id: runId }, data: { createdAt: new Date(Date.now() - 3_600_000), startedAt: new Date(Date.now() - 3_600_000) } });
    const c = await db.identityCandidate.findFirstOrThrow({ where: { runId } });
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: c.id, status: "QUEUED" } });
    await researchPhase(runId, providers);
    expect((await status(runId)).status).toBe("COMPLETE");
  });

  it("stops when cancelled and writes no brief", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
    const cancelling: Providers = {
      ...providers,
      search: { ...providers.search, search: async (q, o) => { await db.researchRun.update({ where: { id: runId }, data: { status: "CANCELLED" } }); return providers.search.search(q, o); } },
    };
    expect(await identifyPhase(runId, cancelling)).toBe("stop");
    expect((await status(runId)).status).toBe("CANCELLED");
    expect(await db.brief.count({ where: { runId } })).toBe(0);
  });

  it("re-running the research phase replaces evidence instead of duplicating it", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
    await identifyPhase(runId, providers);
    await researchPhase(runId, providers);
    const first = await db.claim.count({ where: { runId } });
    // The counters carry over within one run, so they are reset to give the second pass the same allowance as the first.
    await db.researchRun.update({ where: { id: runId }, data: { status: "QUEUED", searches: 0, llmCalls: 0, pagesFetched: 0, inputTokens: 0, outputTokens: 0 } });
    await researchPhase(runId, providers);
    expect(await db.claim.count({ where: { runId } })).toBe(first);
    expect(await db.brief.count({ where: { runId } })).toBe(1);
  });

  it("ignores finished runs", async () => {
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison" });
    await db.researchRun.update({ where: { id: runId }, data: { status: "COMPLETE" } });
    expect(await identifyPhase(runId, providers)).toBe("stop");
    await researchPhase(runId, providers);
    expect(await db.claim.count({ where: { runId } })).toBe(0);
  });
});

describe("recent posts", () => {
  const profile = "https://www.linkedin.com/in/james-harrison-cb";
  const strongLead = { firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov", profileUrl: profile };

  function spy(base: Providers = providers) {
    const conversationInputs: string[] = [];
    const fetchPosts = vi.fn(base.posts!.fetchPosts.bind(base.posts));
    const wrapped: Providers = {
      ...base,
      posts: { fetchPosts },
      llm: { structured: async (req) => { if (req.name === "conversation") conversationInputs.push(req.input); return base.llm.structured(req); } },
    };
    return { wrapped, fetchPosts, conversationInputs };
  }

  it("collects only the person's own original posts, newest first, de-duplicated, labelled as third-party", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun(strongLead);
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);

    expect(fetchPosts).toHaveBeenCalledTimes(1);
    expect(fetchPosts.mock.calls[0][0]).toMatchObject({ profileUrl: profile });

    const posts = await claims(runId, "ACTIVITY");
    expect(posts.map((p) => p.kind)).toEqual(["COLLECTED", "COLLECTED", "COLLECTED"]);
    expect(posts.map((p) => p.eventDate)).toEqual(["2026-09-28", "2026-09-14", "2026-08-30"]);
    expect(posts.some((p) => p.statement.includes("somebody else") || p.statement.includes("colleague"))).toBe(false);
    expect((posts[0].detail as { topic: string }).topic).toBe("Industry update");

    const withSource = await db.claim.findMany({ where: { runId, section: "ACTIVITY" }, include: { source: true } });
    for (const c of withSource) {
      expect(c.source?.kind).toBe("SOCIAL_POST");
      expect(c.source?.text.replace(/\s+/g, " ")).toContain(c.quote!);
      expect(c.source?.url).toMatch(/^https:\/\/www\.linkedin\.com\/posts\//);
    }
    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect((brief.content as { postsCoverage: { profile: string; rejected: number; kept: number } }).postsCoverage).toMatchObject({ profile: "james-harrison-cb", rejected: 2, kept: 3 });
    // Posts, the company page, job postings, the profile picture and the profile details each start one collector run.
    expect((await status(runId)).postRuns).toBe(5);
  });

  it("summarises what the lead shares with each teammate, citing both sides, and keeps the company evidence", async () => {
    const dara = await member("Dara Ng", "dara-ng", "2026-01-04", { headline: "Regulation and transparency advisor", expertise: ["urban transit regulation"] });
    try {
      const { wrapped } = spy();
      const { runId } = await makeRun(strongLead);
      await identifyPhase(runId, wrapped);
      await researchPhase(runId, wrapped);

      const connections = await claims(runId, "CONNECTIONS");
      const summary = connections.find((c) => (c.detail as { summary?: boolean; member?: string }).summary && (c.detail as { member?: string }).member === "Dara Ng");
      expect(summary?.statement).toContain("regulation and transparency");
      const common = connections.find((c) => (c.detail as { commonGround?: boolean }).commonGround);
      expect(common?.statement).toContain("urban transit");
      expect((common!.detail as { members: string[] }).members).toContain("Dara Ng");
      const detail = summary!.detail as { ties: { topic: string; leadQuote: string; memberQuote: string }[]; generated: boolean; rank: number };
      expect(detail.generated).toBe(true);
      expect(detail.ties[0]).toMatchObject({ topic: "Regulation and transparency" });
      const source = await db.source.findUniqueOrThrow({ where: { id: summary!.sourceId! } });
      expect(source.kind).toBe("SOCIAL_POST");
      expect(source.text.toLowerCase()).toContain(summary!.quote!.toLowerCase());
      // Teammates with only a career link are still listed, each with their own sentence.
      expect(connections.filter((c) => (c.detail as { summary?: boolean }).summary).map((c) => (c.detail as { member: string }).member)).toContain("Alex Johnson");
      expect(await claims(runId, "QUALIFICATION")).not.toHaveLength(0);
    } finally {
      await db.teamProfile.delete({ where: { id: dara.id } });
    }
  });

  it("stores the confirmed person's picture once and does not fetch it again for the same profile", async () => {
    const fetchPhoto = vi.fn(providers.photos!.fetchPhoto.bind(providers.photos));
    const wrapped: Providers = { ...providers, photos: { fetchPhoto } };
    const { lead, runId } = await makeRun(strongLead);
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);
    const stored = await db.leadPhoto.findUniqueOrThrow({ where: { leadId: lead.id } });
    expect(stored).toMatchObject({ profileId: "james-harrison-cb", contentType: "image/png" });
    expect(Buffer.from(stored.data).equals(FAKE_PHOTO)).toBe(true);

    await db.researchRun.update({ where: { id: runId }, data: { status: "QUEUED" } });
    await researchPhase(runId, wrapped);
    expect(fetchPhoto).toHaveBeenCalledTimes(1);
  });

  it("fetches no picture when the person is not confirmed or has no profile link", async () => {
    const fetchPhoto = vi.fn(providers.photos!.fetchPhoto.bind(providers.photos));
    const wrapped: Providers = { ...providers, photos: { fetchPhoto } };
    const { lead, runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov" });
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);
    expect(fetchPhoto).not.toHaveBeenCalled();
    expect(await db.leadPhoto.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("lets the company page, job postings and posts each run once even when the collector cap is 1", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun(strongLead, { limits: { maxPostRuns: 1 } });
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);

    expect(fetchPosts).toHaveBeenCalledTimes(1);
    expect((await claims(runId, "ACTIVITY")).some((c) => c.kind === "COLLECTED")).toBe(true);
    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect((brief.content as { partial: string[] }).partial.join(" ")).not.toMatch(/limit/);
  });

  it("does not count collector runs from an interrupted earlier attempt against a restarted research phase", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun(strongLead);
    await identifyPhase(runId, wrapped);
    await db.researchRun.update({ where: { id: runId }, data: { postRuns: 3 } });
    await researchPhase(runId, wrapped);

    expect(fetchPosts).toHaveBeenCalledTimes(1);
    expect((await status(runId)).postRuns).toBe(5);
    const brief = await db.brief.findUniqueOrThrow({ where: { runId } });
    expect((brief.content as { partial: string[] }).partial.join(" ")).not.toMatch(/limit/);
  });

  it("never lets post text reach the conversation prompt, so an injected instruction cannot steer the brief", async () => {
    const { wrapped, conversationInputs } = spy();
    const { runId } = await makeRun(strongLead);
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);
    const prompt = conversationInputs.join("\n");
    expect(prompt).toContain("Posted about: Industry update");
    expect(prompt).not.toMatch(/billionaire|system prompt|ignore all previous/i);
    expect(prompt).not.toContain("urban transit consultation");
    const hyp = (await claims(runId, "CONVERSATION")).map((h) => h.statement).join(" ");
    expect(hyp).not.toMatch(/billionaire/i);
  });

  it("does not collect posts for a candidate nobody confirmed", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun({ firstName: "James", lastName: "Harrison", profileUrl: profile });
    expect(await identifyPhase(runId, wrapped)).toBe("wait");
    const c = await db.identityCandidate.findFirstOrThrow({ where: { runId } });
    await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: c.id, status: "QUEUED" } });
    await researchPhase(runId, wrapped);
    expect(fetchPosts).not.toHaveBeenCalled();
    expect((await claims(runId, "ACTIVITY"))[0].statement).toContain("only collected for a person you have confirmed");
  });

  it("does not guess a profile: without a confirmed LinkedIn link nothing is requested", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun({ ...strongLead, profileUrl: null });
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);
    expect(fetchPosts).not.toHaveBeenCalled();
    const [a] = await claims(runId, "ACTIVITY");
    expect(a).toMatchObject({ kind: "UNAVAILABLE" });
    expect(a.statement).toContain("Add the person's profile link");
  });

  it("ignores a non-LinkedIn or company link instead of treating it as a profile", async () => {
    const { wrapped, fetchPosts } = spy();
    const { runId } = await makeRun({ ...strongLead, profileUrl: "https://www.linkedin.com/company/city-bureau" });
    await identifyPhase(runId, wrapped);
    await researchPhase(runId, wrapped);
    expect(fetchPosts).not.toHaveBeenCalled();
  });

  it("says posts are switched off when no collector is configured", async () => {
    const { runId } = await makeRun(strongLead);
    const off: Providers = { search: providers.search, llm: providers.llm };
    await identifyPhase(runId, off);
    await researchPhase(runId, off);
    expect((await claims(runId, "ACTIVITY"))[0].statement).toContain("not switched on");
    expect((await status(runId)).status).toBe("COMPLETE");
  });

  it("passes the per-brief post cap to the collector and stops at the post-run limit", async () => {
    const capped = spy();
    const { runId } = await makeRun(strongLead, { limits: { maxPosts: 2 } });
    await identifyPhase(runId, capped.wrapped);
    await researchPhase(runId, capped.wrapped);
    expect(capped.fetchPosts.mock.calls[0][0].maxPosts).toBeLessThanOrEqual(12);

    const none = spy();
    const second = await makeRun(strongLead, { limits: { maxPostRuns: 0 } });
    await identifyPhase(second.runId, none.wrapped);
    await researchPhase(second.runId, none.wrapped);
    expect(none.fetchPosts).not.toHaveBeenCalled();
    expect((await status(second.runId)).status).toBe("PARTIAL");
    const brief = await db.brief.findUniqueOrThrow({ where: { runId: second.runId } });
    expect((brief.content as { partial: string[] }).partial.join(" ")).toMatch(/post limit/);
  });

  it("a collector failure leaves a labelled partial brief and the rest intact", async () => {
    const failing: Providers = { ...providers, posts: { fetchPosts: async () => { throw new Error("Post collection failed (HTTP 402)"); } } };
    const { runId } = await makeRun(strongLead);
    await identifyPhase(runId, failing);
    await researchPhase(runId, failing);
    expect((await status(runId)).status).toBe("PARTIAL");
    expect((await claims(runId, "ACTIVITY"))[0].statement).toContain("could not be collected");
    expect((await claims(runId, "WHO")).some((c) => c.kind === "FACT")).toBe(true);
  });

  it("states honestly when the profile has no public posts", async () => {
    const { runId } = await makeRun({ ...strongLead, profileUrl: "https://www.linkedin.com/in/quiet-person" });
    await identifyPhase(runId, providers);
    await researchPhase(runId, providers);
    expect((await claims(runId, "ACTIVITY"))[0].statement).toContain("No public posts");
  });
});

describe("starting runs", () => {
  const enqueueMock = vi.mocked(enqueue);
  const newLead = async (over: Partial<Prisma.LeadUncheckedCreateInput> = {}) => db.lead.create({ data: { createdById: userId, firstName: "Sam", lastName: "Tester", company: "City Bureau", ...over } });

  it("queues a run and marks the lead as being researched", async () => {
    const lead = await newLead();
    const runId = await startRun(lead.id, userId);
    expect(enqueueMock).toHaveBeenCalledWith({ runId, phase: "identify" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("RESEARCHING");
    expect((await status(runId)).status).toBe("QUEUED");
  });

  it("a double click or two open tabs produce one run and one job", async () => {
    const lead = await newLead();
    const ids = await Promise.all(Array.from({ length: 6 }, () => startRun(lead.id, userId)));
    expect(new Set(ids).size).toBe(1);
    expect(await db.researchRun.count({ where: { leadId: lead.id } })).toBe(1);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("refuses someone else's lead", async () => {
    const lead = await newLead();
    await expect(startRun(lead.id, "not-the-owner")).rejects.toBeInstanceOf(RunError);
    expect(await db.researchRun.count({ where: { leadId: lead.id } })).toBe(0);
  });

  it("fails the run at once, instead of leaving it queued for good, when the queue is unreachable", async () => {
    const lead = await newLead();
    enqueueMock.mockRejectedValueOnce(new Error("Connection is closed."));
    await expect(startRun(lead.id, userId)).rejects.toThrow(/not reachable/);
    const run = await db.researchRun.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(run).toMatchObject({ status: "FAILED" });
    expect(run.error).toMatch(/not reachable/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("NEW");

    // The person can simply try again once the service is back: a fresh run, not the dead one.
    const retried = await startRun(lead.id, userId);
    expect(retried).not.toBe(run.id);
    expect((await status(retried)).status).toBe("QUEUED");
  });

  async function waitingRun() {
    const { lead, runId } = await makeRun({ firstName: "James", lastName: "Harrison", company: "City Bureau" });
    const candidate = await db.identityCandidate.create({ data: { runId, name: "James Harrison", confidence: "POSSIBLE", matches: [], mismatches: [], evidence: { signals: [], quote: null, sources: [] } } });
    await db.researchRun.update({ where: { id: runId }, data: { status: "AWAITING_CONFIRMATION", stage: "Choose the right person" } });
    return { lead, runId, candidateId: candidate.id };
  }

  it("puts a confirmed choice back to waiting, so nothing is lost, when the queue is unreachable", async () => {
    const { runId, candidateId } = await waitingRun();
    enqueueMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(confirmCandidate(runId, userId, candidateId)).rejects.toThrow(/not reachable/);
    const run = await status(runId);
    expect(run).toMatchObject({ status: "AWAITING_CONFIRMATION", selectedCandidateId: null, identityConfirmed: false });
    expect(run.stage).toMatch(/not reachable/);

    await confirmCandidate(runId, userId, candidateId);
    expect(await status(runId)).toMatchObject({ status: "QUEUED", selectedCandidateId: candidateId, identityConfirmed: true });
    expect(enqueueMock).toHaveBeenLastCalledWith({ runId, phase: "research" });
  });

  it("does the same for continuing with company information only", async () => {
    const { runId } = await waitingRun();
    enqueueMock.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(continueWithoutPerson(runId, userId)).rejects.toThrow(/not reachable/);
    expect((await status(runId)).status).toBe("AWAITING_CONFIRMATION");
    await continueWithoutPerson(runId, userId);
    expect((await status(runId)).status).toBe("QUEUED");
  });

  it("answering twice queues only one research job", async () => {
    const { runId, candidateId } = await waitingRun();
    await Promise.all([confirmCandidate(runId, userId, candidateId), confirmCandidate(runId, userId, candidateId).catch(() => undefined)]);
    expect(enqueueMock.mock.calls.filter(([j]) => j.phase === "research")).toHaveLength(1);
  });

  it("a stopped run frees the lead for a new one", async () => {
    const lead = await newLead();
    const first = await startRun(lead.id, userId);
    await cancelRun(first, userId);
    expect((await status(first)).status).toBe("CANCELLED");
    expect(await startRun(lead.id, userId)).not.toBe(first);
  });
});

describe("hostile and slow conditions", () => {
  const strongLead = { firstName: "James", lastName: "Harrison", company: "City Bureau", email: "james.harrison@citybureau.example.gov", profileUrl: "https://www.linkedin.com/in/james-harrison-cb" };

  it("says so, rather than 'no posts', when posts came back but none belonged to the profile", async () => {
    const stranger = { ...providers, posts: { fetchPosts: async () => (await providers.posts!.fetchPosts({ profileUrl: "https://www.linkedin.com/in/james-harrison-cb", maxPosts: 12, maxChargeUsd: 1 })).map((p) => ({ ...p, authorId: "someone-else" })) } };
    const { runId } = await makeRun(strongLead);
    await identifyPhase(runId, stranger);
    await researchPhase(runId, stranger);
    const [a] = await claims(runId, "ACTIVITY");
    expect(a).toMatchObject({ kind: "UNAVAILABLE", statement: POSTS_NOT_MATCHED });
  });

  it("a provider that hangs ends the run at its time limit instead of spinning", async () => {
    const hanging: Providers = { ...providers, search: { search: () => new Promise(() => undefined), extract: () => new Promise(() => undefined) } };
    const { runId } = await makeRun(strongLead, { limits: { maxSeconds: 1 } });
    const started = Date.now();
    expect(await identifyPhase(runId, hanging)).toBe("stop");
    expect(Date.now() - started).toBeLessThan(5_000);
    const run = await status(runId);
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/limit/);
  });

  it("a search that fails outright yields a clear failure, not a stuck run", async () => {
    const down: Providers = { ...providers, search: { search: async () => { throw new Error("ENOTFOUND api.tavily.com"); }, extract: async () => [] } };
    const { runId } = await makeRun(strongLead);
    expect(await identifyPhase(runId, down)).toBe("stop");
    const run = await status(runId);
    expect(run.status).toBe("FAILED");
    expect(run.error).not.toContain("tavily");
  });

  it("names with quotes, control characters and very long values still produce a safe query", async () => {
    const seen: string[] = [];
    const spy: Providers = { ...providers, search: { search: async (q, o) => (seen.push(q), providers.search.search(q, o)), extract: providers.search.extract } };
    const { runId } = await makeRun({ firstName: 'James "The" ', lastName: "Harrison\u0007", company: `City "Bureau" ${"x".repeat(400)}` });
    await identifyPhase(runId, spy);
    expect(seen.length).toBeGreaterThan(0);
    for (const q of seen) {
      expect(q.length).toBeLessThan(400);
      expect(q).not.toMatch(/\u0007/);
      expect((q.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });
});
