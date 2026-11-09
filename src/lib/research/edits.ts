import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { log, runRef } from "@/lib/log";
import { cleanText } from "./policy";
import { RunError } from "./runs";
import type { Prisma } from "@/generated/prisma/client";

const FINISHED = ["COMPLETE", "PARTIAL"];
const MAX_STATEMENT = 1500;

// Company checks feed the recommendation, which has its own override; posts are someone else's words, so they can only be removed.
const EDITABLE = new Set(["WHO", "CONNECTIONS", "NOW", "CONVERSATION"]);

async function ownedClaim(claimId: string, userId: string) {
  const claim = await db.claim.findFirst({ where: { id: claimId, run: { requestedById: userId } }, include: { run: { select: { id: true, status: true } } } });
  if (!claim) throw new RunError("That item was not found.");
  if (!FINISHED.includes(claim.run.status)) throw new RunError("The brief is not finished yet.");
  return claim;
}

// The wording they replaced is kept, so the change can be undone and nothing is lost.
export async function editClaim(claimId: string, userId: string, statement: string) {
  const claim = await ownedClaim(claimId, userId);
  if (!EDITABLE.has(claim.section) || claim.kind === "UNAVAILABLE") throw new RunError("This item cannot be edited. You can remove it instead.");
  const text = cleanText(statement).trim();
  if (!text) throw new RunError("Write something, or remove the item instead.");
  if (text.length > MAX_STATEMENT) throw new RunError(`Keep it under ${MAX_STATEMENT} characters.`);
  if (text === claim.statement) return;
  await db.claim.update({ where: { id: claimId }, data: { statement: text, originalStatement: claim.originalStatement ?? claim.statement, editedAt: new Date() } });
  log.info("claim.edited", { runId: claim.runId, ref: runRef(claim.runId), claimId, section: claim.section });
}

export async function revertClaim(claimId: string, userId: string) {
  const claim = await ownedClaim(claimId, userId);
  if (claim.originalStatement === null) return;
  // A point the assistant rewrote also kept its earlier supporting text.
  const detail = { ...((claim.detail as Record<string, unknown> | null) ?? {}) };
  const earlier = detail.originalDetail as Record<string, unknown> | undefined;
  if (earlier) {
    delete detail.originalDetail;
    for (const [k, v] of Object.entries(earlier)) detail[k] = v;
  }
  await db.claim.update({ where: { id: claimId }, data: { statement: claim.originalStatement, originalStatement: null, editedAt: null, ...(earlier ? { detail: detail as Prisma.InputJsonValue } : {}) } });
  log.info("claim.reverted", { runId: claim.runId, ref: runRef(claim.runId), claimId });
}

export async function setClaimHidden(claimId: string, userId: string, hidden: boolean) {
  const claim = await ownedClaim(claimId, userId);
  if (claim.section === "QUALIFICATION" || claim.kind === "UNAVAILABLE") throw new RunError("This item cannot be removed.");
  await db.claim.update({ where: { id: claimId }, data: { hidden } });
  log.info(hidden ? "claim.hidden" : "claim.restored", { runId: claim.runId, ref: runRef(claim.runId), claimId, section: claim.section });
}

const contentSchema = z.object({
  gaps: z.array(z.string().trim().min(1).max(300)).max(8).optional(),
});

export type ContentPatch = z.input<typeof contentSchema>;

// The gaps live with the brief rather than as claims.
export async function editBriefContent(runId: string, userId: string, patch: ContentPatch) {
  const run = await db.researchRun.findFirst({ where: { id: runId, requestedById: userId }, select: { id: true, status: true } });
  if (!run) throw new RunError("Run not found.");
  if (!FINISHED.includes(run.status)) throw new RunError("The brief is not finished yet.");
  const parsed = contentSchema.safeParse({
    gaps: patch.gaps?.map(cleanText),
  });
  if (!parsed.success) throw new RunError("Check the text: it is empty or too long.");
  const brief = await db.brief.findUnique({ where: { runId } });
  if (!brief) throw new RunError("There is no brief to edit.");
  const next = { ...(brief.content as Record<string, unknown>) };
  if (parsed.data.gaps) next.gaps = parsed.data.gaps;
  await db.brief.update({ where: { runId }, data: { content: next as Prisma.InputJsonValue } });
  log.info("brief.content_edited", { runId, ref: runRef(runId), fields: Object.keys(parsed.data).filter((k) => parsed.data[k as keyof typeof parsed.data] !== undefined) });
}
