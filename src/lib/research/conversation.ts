import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { CatalogueData } from "@/lib/catalogue/parse";
import { memberText } from "./team-fit";
import { synthesize, type BasisClaim, type CheckedSynthesis } from "./synthesis";
import type { LlmProvider } from "./types";

const json = (v: unknown) => v as Prisma.InputJsonValue;

type Detail = { summary?: boolean; commonGround?: boolean; member?: string; topic?: string };
const detailOf = (c: { detail: unknown }) => (c.detail ?? {}) as Detail;

// The evidence the call plan may cite, read back from what is stored for the run.
export async function loadBasis(runId: string): Promise<BasisClaim[]> {
  const stored = await db.claim.findMany({
    where: { runId, hidden: false, kind: { in: ["FACT", "PROVIDED", "POTENTIAL", "COLLECTED"] }, section: { in: ["WHO", "NOW", "CONNECTIONS", "ACTIVITY", "QUALIFICATION"] } },
    orderBy: [{ section: "asc" }, { position: "asc" }],
  });
  // Individual link claims are folded into each member's summary, so only the summaries and the overall common ground are offered as evidence.
  return stored
    .filter((c) => c.section !== "CONNECTIONS" || detailOf(c).summary || detailOf(c).commonGround)
    .map((c) => ({
      id: c.id,
      label: c.kind === "PROVIDED" ? "provided by the lead" : c.section === "CONNECTIONS" ? "possible common ground with our team" : c.kind === "COLLECTED" ? `recent post ${c.eventDate ?? ""}`.trim() : c.section === "NOW" ? `announcement ${c.eventDate ?? ""}`.trim() : c.section === "QUALIFICATION" ? "company or market fact" : "verified",
      text: c.kind === "COLLECTED" ? (detailOf(c).topic ? `Posted about: ${detailOf(c).topic}` : "Posted recently on LinkedIn") : c.section === "CONNECTIONS" ? `${detailOf(c).commonGround ? "Our team" : (detailOf(c).member ?? "A team member")}: ${c.statement}` : c.statement,
    }));
}

export type Salesperson = { name: string; profile: Parameters<typeof memberText>[0] };

export async function composeConversation(args: { runId: string; person: string; unidentified: boolean; catalogue: CatalogueData | null; forMember: Salesperson | null; llm: LlmProvider }): Promise<CheckedSynthesis> {
  const { runId, person, unidentified, catalogue, forMember, llm } = args;
  const basis = await loadBasis(runId);
  const gapRows = await db.claim.findMany({ where: { runId, section: "QUALIFICATION", kind: "UNAVAILABLE" }, select: { statement: true } });
  return synthesize({ person, unidentified, basis, catalogue, gaps: gapRows.map((g) => g.statement), forMember: forMember ? { name: forMember.name, profile: memberText(forMember.profile) } : null }, llm);
}

// Replaces the angle and reasons to call now. Used both when a brief is first written and when it is retargeted at another teammate.
export async function saveConversation(runId: string, conversation: CheckedSynthesis | null) {
  const points: Prisma.ClaimCreateManyInput[] = [];
  const solved = (h: { solutionId: string | null; solutionName: string | null; whyRelevant: string | null }) => ({ solutionId: h.solutionId, solutionName: h.solutionName, whyRelevant: h.whyRelevant });
  if (conversation?.angle) points.push({ runId, section: "CONVERSATION", kind: "HYPOTHESIS", statement: conversation.angle.headline, detail: json({ role: "angle", insight: conversation.angle.insight, objection: conversation.angle.objection, ...solved(conversation.angle), basisClaimIds: conversation.angle.basisClaimIds }), position: 0 });
  conversation?.triggers.forEach((h, i) => points.push({ runId, section: "CONVERSATION", kind: "HYPOTHESIS", statement: h.what, detail: json({ role: "trigger", type: h.type, soWhat: h.soWhat, ...solved(h), basisClaimIds: h.basisClaimIds }), position: i + 1 }));
  if (!conversation) points.push({ runId, section: "CONVERSATION", kind: "UNAVAILABLE", statement: "Conversation suggestions could not be prepared.", position: 0 });
  await db.$transaction([db.claim.deleteMany({ where: { runId, section: "CONVERSATION" } }), ...(points.length ? [db.claim.createMany({ data: points })] : [])]);
  return points.length;
}

export const WHO_FOR_QUESTION = "Who is this brief for? Pick a teammate and I will tailor the fit and the angle for them.";
