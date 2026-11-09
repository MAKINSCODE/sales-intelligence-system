"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { RunError, deleteLead, approveRun, cancelRun, confirmCandidate, continueWithoutPerson, deleteBrief, overrideDecision, rateBrief, rejectRun, researchAnyway, restartRun, startRun } from "@/lib/research/runs";
import { editBriefContent, editClaim, revertClaim, setClaimHidden, type ContentPatch } from "@/lib/research/edits";
import { applyProposal, askAboutBrief, dismissProposal, retargetBrief } from "@/lib/research/chat";
import { db } from "@/lib/db";
import { leadSchema, type LeadFieldErrors } from "@/lib/leads";
import type { QualDecision } from "@/generated/prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function guard(action: string, fn: () => Promise<void>, leadId: string): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath(`/leads/${leadId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof RunError) {
      log.warn("action.rejected", { action, leadId, reason: e.message });
      return { ok: false, error: e.message };
    }
    log.error("action.failed", { action, leadId, err: e });
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// Skipping the review builds the brief without stopping for the person's decision on the recommendation.
export async function generateBrief(leadId: string, skipReview = false, forMemberId: string | null = null): Promise<ActionResult> {
  const user = await requireUser();
  return guard("generateBrief", async () => void (await startRun(leadId, user.id, { bypassScreen: skipReview === true, forMemberId })), leadId);
}

export async function chooseCandidate(leadId: string, runId: string, candidateId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("chooseCandidate", () => confirmCandidate(runId, user.id, candidateId), leadId);
}

export async function proceedWithoutPerson(leadId: string, runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("proceedWithoutPerson", () => continueWithoutPerson(runId, user.id), leadId);
}

export async function restartBrief(leadId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("restartBrief", async () => void (await restartRun(leadId, user.id)), leadId);
}

export async function deleteLeadBrief(leadId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("deleteLeadBrief", () => deleteBrief(leadId, user.id), leadId);
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const user = await requireUser();
  const res = await guard("deleteLead", () => deleteLead(leadId, user.id), leadId);
  if (res.ok) revalidatePath("/");
  return res;
}

export async function approveLead(leadId: string, runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("approveLead", () => approveRun(runId, user.id), leadId);
}

export async function rejectLead(leadId: string, runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("rejectLead", () => rejectRun(runId, user.id), leadId);
}

export async function stopRun(leadId: string, runId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("stopRun", () => cancelRun(runId, user.id), leadId);
}

export async function submitRating(leadId: string, runId: string, rating: number, note: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("submitRating", () => rateBrief(runId, user.id, rating, note || null), leadId);
}

export async function startAnyway(leadId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("startAnyway", async () => void (await researchAnyway(leadId, user.id)), leadId);
}

const DECISIONS = new Set<QualDecision>(["QUALIFIED", "DISQUALIFIED", "NEEDS_REVIEW"]);

export async function changeDecision(leadId: string, runId: string, decision: QualDecision | null, note: string): Promise<ActionResult> {
  const user = await requireUser();
  if (decision !== null && !DECISIONS.has(decision)) return { ok: false, error: "Choose a decision." };
  return guard("changeDecision", () => overrideDecision(runId, user.id, decision, note || null), leadId);
}

export async function editBriefClaim(leadId: string, claimId: string, statement: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("editBriefClaim", () => editClaim(claimId, user.id, statement), leadId);
}

export async function revertBriefClaim(leadId: string, claimId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("revertBriefClaim", () => revertClaim(claimId, user.id), leadId);
}

export async function removeBriefClaim(leadId: string, claimId: string, hidden: boolean): Promise<ActionResult> {
  const user = await requireUser();
  return guard("removeBriefClaim", () => setClaimHidden(claimId, user.id, hidden === true), leadId);
}

export async function editBriefText(leadId: string, runId: string, patch: ContentPatch): Promise<ActionResult> {
  const user = await requireUser();
  return guard("editBriefText", () => editBriefContent(runId, user.id, patch), leadId);
}

export async function askBrief(leadId: string, runId: string, message: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("askBrief", () => askAboutBrief(runId, user.id, message), leadId);
}

export async function setBriefFor(leadId: string, runId: string, memberId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("setBriefFor", () => retargetBrief(runId, user.id, memberId), leadId);
}

export async function applyBriefChange(leadId: string, runId: string, messageId: string, proposalId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("applyBriefChange", () => applyProposal(runId, user.id, messageId, proposalId), leadId);
}

export async function dismissBriefChange(leadId: string, runId: string, messageId: string, proposalId: string): Promise<ActionResult> {
  const user = await requireUser();
  return guard("dismissBriefChange", () => dismissProposal(runId, user.id, messageId, proposalId), leadId);
}

export type LeadDetailsResult = { ok: true } | { ok: false; error: string; errors?: LeadFieldErrors };

const DETAIL_FIELDS = ["firstName", "lastName", "company", "jobTitle", "profileUrl", "email", "country", "enquiryText", "notes"] as const;

// A correction to what was submitted. It reaches the brief the next time the research is refreshed.
export async function updateLeadDetails(leadId: string, values: Record<string, string>): Promise<LeadDetailsResult> {
  const user = await requireUser();
  const parsed = leadSchema.safeParse(Object.fromEntries(DETAIL_FIELDS.map((f) => [f, String(values[f] ?? "")])));
  if (!parsed.success) {
    const errors: LeadFieldErrors = {};
    for (const issue of parsed.error.issues) errors[issue.path[0] as keyof LeadFieldErrors] ??= issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", errors };
  }
  try {
    const data = Object.fromEntries(DETAIL_FIELDS.map((f) => [f, parsed.data[f] ?? null]));
    const res = await db.lead.updateMany({ where: { id: leadId, createdById: user.id }, data });
    if (res.count === 0) return { ok: false, error: "Lead not found." };
    revalidatePath(`/leads/${leadId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    log.error("lead.update_failed", { leadId, err: e });
    return { ok: false, error: "The details could not be saved. Please try again." };
  }
}
