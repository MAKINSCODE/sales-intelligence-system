import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./queue", () => ({ enqueue: vi.fn().mockResolvedValue(undefined) }));

import { db } from "@/lib/db";
import { applyProposal, askAboutBrief, dismissProposal, retargetBrief, toProposals, type ChatOutput } from "./chat";
import { editBriefContent, editClaim, revertClaim, setClaimHidden } from "./edits";
import { fakeProviders } from "./fake-providers";
import { limitsFromEnv } from "./pipeline";
import { RunError } from "./runs";
import { loadRunView, roleFromClaims } from "./view";

// The model is the deterministic stand-in, never the real one.
const ask = (runId: string, userId: string, question: string) => askAboutBrief(runId, userId, question, fakeProviders().llm);

let userId: string;
let otherId: string;

beforeAll(async () => {
  await db.$executeRawUnsafe(`truncate "BriefMessage","Claim","Brief","Source","IdentityCandidate","ResearchRun","Lead","TeamProfile","CompanyCatalogue","QualificationSettings","Session","LoginToken","User" cascade`);
  userId = (await db.user.create({ data: { email: "edits@example.com", role: "ADMIN", status: "ACTIVE" } })).id;
  otherId = (await db.user.create({ data: { email: "other@example.com", role: "MEMBER", status: "ACTIVE" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

// A finished brief with one claim of each kind that can be changed.
async function finishedBrief(status: "COMPLETE" | "QUEUED" = "COMPLETE") {
  const lead = await db.lead.create({ data: { createdById: userId, firstName: "James", lastName: "Harrison" } });
  const run = await db.researchRun.create({ data: { leadId: lead.id, requestedById: userId, status, limits: limitsFromEnv() } });
  const claim = (data: { section: "WHO" | "NOW" | "ACTIVITY" | "CONVERSATION" | "QUALIFICATION"; kind: "FACT" | "COLLECTED" | "HYPOTHESIS" | "UNAVAILABLE"; statement: string; detail?: object; position?: number }) =>
    db.claim.create({ data: { runId: run.id, position: 0, ...data } });
  const who = await claim({ section: "WHO", kind: "FACT", statement: "Chief Executive at City Bureau", detail: { group: "current", title: "Chief Executive", organisation: "City Bureau" } });
  const news = await claim({ section: "NOW", kind: "FACT", statement: "City Bureau launched a new initiative." });
  const post = await claim({ section: "ACTIVITY", kind: "COLLECTED", statement: "A post about cooling." });
  const angle = await claim({ section: "CONVERSATION", kind: "HYPOTHESIS", statement: "Operations are changing, so an agent can take on the load.", detail: { role: "angle", insight: "Original insight.", objection: "Original pushback." } });
  const qual = await claim({ section: "QUALIFICATION", kind: "FACT", statement: "About 320 employees", detail: { group: "company" } });
  const gap = await claim({ section: "WHO", kind: "UNAVAILABLE", statement: "Nothing more was found." });
  await db.brief.create({ data: { runId: run.id, model: "test", content: { gaps: ["Who decides"], partial: [] } } });
  return { lead, runId: run.id, who, news, post, angle, qual, gap };
}

const claimRow = (id: string) => db.claim.findUniqueOrThrow({ where: { id } });
const briefContent = async (runId: string) => (await db.brief.findUniqueOrThrow({ where: { runId } })).content as { gaps: string[] };

describe("changing a claim", () => {
  it("keeps the wording that was replaced, and can put it back", async () => {
    const b = await finishedBrief();
    await editClaim(b.news.id, userId, "  City Bureau   launched an urban transit initiative.  ");
    expect(await claimRow(b.news.id)).toMatchObject({ statement: "City Bureau   launched an urban transit initiative.", originalStatement: "City Bureau launched a new initiative." });
    expect((await claimRow(b.news.id)).editedAt).toBeInstanceOf(Date);

    // A second edit still remembers the very first wording.
    await editClaim(b.news.id, userId, "City Bureau changed its plans.");
    expect((await claimRow(b.news.id)).originalStatement).toBe("City Bureau launched a new initiative.");

    await revertClaim(b.news.id, userId);
    expect(await claimRow(b.news.id)).toMatchObject({ statement: "City Bureau launched a new initiative.", originalStatement: null, editedAt: null });
  });

  it("shows an edited claim as edited in the view", async () => {
    const b = await finishedBrief();
    await editClaim(b.who.id, userId, "Chief Executive Officer at City Bureau");
    const view = await loadRunView(b.lead.id, userId);
    expect(view?.claims.find((c) => c.id === b.who.id)).toMatchObject({ edited: true, originalStatement: "Chief Executive at City Bureau", hidden: false });
  });

  it("refuses text that is empty or too long, and unchanged text does nothing", async () => {
    const b = await finishedBrief();
    await expect(editClaim(b.news.id, userId, "   ")).rejects.toThrow(RunError);
    await expect(editClaim(b.news.id, userId, "x".repeat(1501))).rejects.toThrow(/under 1500/);
    await editClaim(b.news.id, userId, "City Bureau launched a new initiative.");
    expect((await claimRow(b.news.id)).editedAt).toBeNull();
  });

  it("does not let a post be rewritten, an empty notice be edited, or someone else's brief be touched", async () => {
    const b = await finishedBrief();
    await expect(editClaim(b.post.id, userId, "Something else")).rejects.toThrow(/cannot be edited/);
    await expect(editClaim(b.gap.id, userId, "Something else")).rejects.toThrow(/cannot be edited/);
    await expect(editClaim(b.qual.id, userId, "About 5 employees")).rejects.toThrow(/cannot be edited/);
    await expect(editClaim(b.news.id, otherId, "Mine now")).rejects.toThrow(/not found/);
    await expect(setClaimHidden(b.news.id, otherId, true)).rejects.toThrow(/not found/);
  });

  it("does not change a brief that is still being built", async () => {
    const b = await finishedBrief("QUEUED");
    await expect(editClaim(b.news.id, userId, "Early edit")).rejects.toThrow(/not finished/);
  });
});

describe("removing a claim", () => {
  it("hides it without deleting it, and restores it", async () => {
    const b = await finishedBrief();
    await setClaimHidden(b.post.id, userId, true);
    expect((await claimRow(b.post.id)).hidden).toBe(true);
    expect((await loadRunView(b.lead.id, userId))?.claims.find((c) => c.id === b.post.id)?.hidden).toBe(true);
    await setClaimHidden(b.post.id, userId, false);
    expect((await claimRow(b.post.id)).hidden).toBe(false);
  });

  it("keeps the company checks, which have their own override, from being removed", async () => {
    const b = await finishedBrief();
    await expect(setClaimHidden(b.qual.id, userId, true)).rejects.toThrow(/cannot be removed/);
    await expect(setClaimHidden(b.gap.id, userId, true)).rejects.toThrow(/cannot be removed/);
  });

  it("stops showing a removed role as the company and title found online", async () => {
    const b = await finishedBrief();
    const claims = await db.claim.findMany({ where: { runId: b.runId }, select: { detail: true, hidden: true } });
    expect(roleFromClaims(claims)).toEqual({ company: "City Bureau", jobTitle: "Chief Executive" });
    await setClaimHidden(b.who.id, userId, true);
    expect(roleFromClaims(await db.claim.findMany({ where: { runId: b.runId }, select: { detail: true, hidden: true } }))).toEqual({ company: null, jobTitle: null });
    expect((await loadRunView(b.lead.id, userId))?.found.company).toBeNull();
  });
});

describe("the gaps", () => {
  it("are edited, replaced and removed", async () => {
    const b = await finishedBrief();
    await editBriefContent(b.runId, userId, { gaps: ["  Who owns the budget  "] });
    expect(await briefContent(b.runId)).toMatchObject({ gaps: ["Who owns the budget"] });
    await editBriefContent(b.runId, userId, { gaps: [] });
    expect((await briefContent(b.runId)).gaps).toEqual([]);
  });

  it("refuse an empty gap and another person's brief", async () => {
    const b = await finishedBrief();
    await expect(editBriefContent(b.runId, userId, { gaps: [" "] })).rejects.toThrow(RunError);
    await expect(editBriefContent(b.runId, otherId, { gaps: ["Mine"] })).rejects.toThrow(/not found/);
  });
});

describe("proposals from the assistant", () => {
  const rows = (id: string, role: "angle" | "trigger" = "angle") => new Map([[id, { id, section: "CONVERSATION", kind: "HYPOTHESIS", statement: "Old", quote: null, editedAt: null, detail: { role } }]]);
  const content = { gaps: ["g1"] };
  const change = (over: Partial<ChatOutput["changes"][number]>): ChatOutput["changes"][number] => ({ kind: "set_gaps", summary: "Do it", claimId: null, text: null, detail: null, objection: null, gaps: null, ...over });

  it("keeps well-formed changes and records what they replace", () => {
    const out = toProposals(
      [change({ kind: "rewrite_point", claimId: "a1", text: "Sharper angle", detail: "Why", objection: "Pushback" }), change({ kind: "set_gaps", gaps: ["g1", "g2"] })],
      { points: rows("a1") as never, content },
    );
    expect(out.map((p) => p.kind)).toEqual(["rewrite_point", "set_gaps"]);
    expect(out[1]).toMatchObject({ status: "pending", before: ["g1"], gaps: ["g1", "g2"] });
    expect(out[0]).toMatchObject({ before: "Old", statement: "Sharper angle", insight: "Why", objection: "Pushback" });
  });

  it("drops a rewrite of something that is not a point of the call plan, an invented figure, or an empty change", () => {
    const out = toProposals(
      [change({ kind: "rewrite_point", claimId: "someone-elses-fact", text: "Rewrite" }), change({ kind: "rewrite_point", claimId: "a1", text: "Customers see a 40% saving." }), change({ kind: "rewrite_point", claimId: "a1", text: " " })],
      { points: rows("a1") as never, content },
    );
    expect(out).toEqual([]);
  });

  it("ignores a pushback on a reason to call now, which has none", () => {
    const [p] = toProposals([change({ kind: "rewrite_point", claimId: "t1", text: "New", detail: "Because", objection: "Nope" })], { points: rows("t1", "trigger") as never, content });
    expect(p).toMatchObject({ kind: "rewrite_point", objection: null });
  });
});

describe("asking about a brief", () => {
  it("answers from the evidence, cites only real items, and saves the exchange", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "Who is this person?");
    const messages = await db.briefMessage.findMany({ where: { runId: b.runId }, orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(messages[0].content).toBe("Who is this person?");
    expect(messages[1].content).toContain("Chief Executive at City Bureau");
    expect(messages[1].citations).toEqual([b.who.id]);
    expect(messages[1].proposals).toBeNull();
  });

  it("says so when the brief does not hold the answer, rather than guessing", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "What is their favourite food for dinner?");
    const reply = (await db.briefMessage.findFirstOrThrow({ where: { runId: b.runId, role: "ASSISTANT" } })).content;
    expect(reply).toContain("The brief does not say");
  });

  it("proposes a change that only takes effect when applied, and can be dismissed", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "Make the gaps shorter please");
    const view = await loadRunView(b.lead.id, userId);
    const msg = view!.messages.find((m) => m.role === "ASSISTANT")!;
    expect(msg.proposals).toHaveLength(1);
    expect(msg.proposals[0]).toMatchObject({ kind: "set_gaps", status: "pending", before: ["Who decides"] });
    expect((await briefContent(b.runId)).gaps).toEqual(["Who decides"]);

    await applyProposal(b.runId, userId, msg.id, msg.proposals[0].id);
    expect((await briefContent(b.runId)).gaps).toEqual(["Who owns the budget"]);
    await expect(applyProposal(b.runId, userId, msg.id, msg.proposals[0].id)).rejects.toThrow(/already handled/);

    await ask(b.runId, userId, "Make the gaps shorter again");
    const second = (await loadRunView(b.lead.id, userId))!.messages.filter((m) => m.role === "ASSISTANT")[1];
    await dismissProposal(b.runId, userId, second.id, second.proposals[0].id);
    const after = (await loadRunView(b.lead.id, userId))!.messages.filter((m) => m.role === "ASSISTANT");
    expect(after.map((m) => m.proposals[0].status)).toEqual(["applied", "dismissed"]);
  });

  it("rewrites the angle, marks it edited, and reverting restores its supporting text too", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "Rewrite the angle to be sharper");
    const msg = (await loadRunView(b.lead.id, userId))!.messages.find((m) => m.role === "ASSISTANT")!;
    await applyProposal(b.runId, userId, msg.id, msg.proposals[0].id);
    const changed = await claimRow(b.angle.id);
    expect(changed.statement).toBe("Their operations are under pressure, and an agent can take on the repetitive load.");
    expect(changed.originalStatement).toBe("Operations are changing, so an agent can take on the load.");
    expect(changed.editedAt).not.toBeNull();

    await revertClaim(b.angle.id, userId);
    const back = await claimRow(b.angle.id);
    expect(back.statement).toBe("Operations are changing, so an agent can take on the load.");
    expect(back.detail).toMatchObject({ role: "angle", insight: "Original insight.", objection: "Original pushback." });
    expect(back.detail).not.toHaveProperty("originalDetail");
  });

  it("cannot apply a change to a point that was removed since", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "Rewrite the angle to be sharper");
    const msg = (await loadRunView(b.lead.id, userId))!.messages.find((m) => m.role === "ASSISTANT")!;
    await setClaimHidden(b.angle.id, userId, true);
    await expect(applyProposal(b.runId, userId, msg.id, msg.proposals[0].id)).rejects.toThrow(/removed/);
    expect((await claimRow(b.angle.id)).editedAt).toBeNull();
  });

  it("is only for a finished brief, the owner, and a sensible question", async () => {
    const b = await finishedBrief();
    await expect(ask(b.runId, otherId, "Hello?")).rejects.toThrow(/not found/);
    await expect(ask(b.runId, userId, "   ")).rejects.toThrow(/Write a question/);
    await expect(ask(b.runId, userId, "x".repeat(1001))).rejects.toThrow(/under 1000/);
    const early = await finishedBrief("QUEUED");
    await expect(ask(early.runId, userId, "Hello?")).rejects.toThrow(/not finished/);
    expect(await db.briefMessage.count({ where: { runId: early.runId } })).toBe(0);
  });

  it("stops after a fixed number of questions per brief", async () => {
    const b = await finishedBrief();
    await db.briefMessage.createMany({ data: Array.from({ length: 40 }, () => ({ runId: b.runId, role: "USER" as const, content: "q" })) });
    await expect(ask(b.runId, userId, "One more?")).rejects.toThrow(/limit/);
  });

  it("is deleted with the brief", async () => {
    const b = await finishedBrief();
    await ask(b.runId, userId, "Who is this person?");
    await db.researchRun.delete({ where: { id: b.runId } });
    expect(await db.briefMessage.count({ where: { runId: b.runId } })).toBe(0);
  });
});

describe("retargeting a brief", () => {
  const llm = fakeProviders().llm;

  it("points the brief at another teammate, writes the angle again for them, and says so in the chat", async () => {
    const b = await finishedBrief();
    const ada = await db.teamProfile.create({ data: { linkedinUrl: "https://www.linkedin.com/in/sam-retarget", fullName: "Sam Torres", status: "READY", lastRefreshedAt: new Date(), education: [], employment: [], locations: [], expertise: [] } });
    const oldAngle = (await db.claim.findMany({ where: { runId: b.runId, section: "CONVERSATION" } })).map((c) => c.id);

    await retargetBrief(b.runId, userId, ada.id, llm);

    expect((await db.researchRun.findUniqueOrThrow({ where: { id: b.runId } })).forMemberId).toBe(ada.id);
    const after = await db.claim.findMany({ where: { runId: b.runId, section: "CONVERSATION" } });
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((c) => oldAngle.includes(c.id))).toBe(false);
    expect((await loadRunView(b.lead.id, userId))!.forMember).toEqual({ id: ada.id, name: "Sam Torres" });
    const msgs = await db.briefMessage.findMany({ where: { runId: b.runId } });
    expect(msgs).toMatchObject([{ role: "ASSISTANT", content: expect.stringContaining("now for Sam Torres") }]);
  });

  it("refuses someone who is not on the team, an unfinished brief, and another person's brief", async () => {
    const b = await finishedBrief();
    await expect(retargetBrief(b.runId, userId, "not-a-member", llm)).rejects.toThrow(/not on the team/);
    const ada = await db.teamProfile.create({ data: { linkedinUrl: "https://www.linkedin.com/in/sam-two", fullName: "Sam Two", status: "READY", lastRefreshedAt: new Date(), education: [], employment: [], locations: [], expertise: [] } });
    await expect(retargetBrief(b.runId, otherId, ada.id, llm)).rejects.toThrow(/not found/);
    const unfinished = await finishedBrief("QUEUED");
    await expect(retargetBrief(unfinished.runId, userId, ada.id, llm)).rejects.toThrow(/not finished/);
  });
});
