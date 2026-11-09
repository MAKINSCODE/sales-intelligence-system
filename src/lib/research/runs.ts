import "server-only";
import { db } from "@/lib/db";
import { getActiveCatalogue } from "@/lib/catalogue/service";
import { log, runRef } from "@/lib/log";
import { enqueue, type ResearchJob } from "./queue";
import { limitsFromEnv } from "./pipeline";
import type { Prisma, QualDecision } from "@/generated/prisma/client";

const ACTIVE = ["QUEUED", "QUALIFYING", "AWAITING_APPROVAL", "IDENTIFYING", "AWAITING_CONFIRMATION", "RESEARCHING", "WRITING"] as const;

export class RunError extends Error {}

const UNREACHABLE = "The research service is not reachable right now. Please try again in a minute.";

// A run that was saved but could not be queued would otherwise sit "queued" for good, so it is put back or failed.
async function enqueueOrRecover(job: ResearchJob, leadId: string, onFail: "restart" | "wait" | "approval") {
  try {
    await enqueue(job);
  } catch {
    const active = { id: job.runId, status: { in: [...ACTIVE] } };
    if (onFail === "wait") {
      await db.researchRun.updateMany({ where: active, data: { status: "AWAITING_CONFIRMATION", selectedCandidateId: null, identityConfirmed: false, stage: UNREACHABLE } });
    } else if (onFail === "approval") {
      await db.researchRun.updateMany({ where: active, data: { status: "AWAITING_APPROVAL", stage: UNREACHABLE } });
    } else {
      await db.researchRun.updateMany({ where: active, data: { status: "FAILED", stage: null, error: UNREACHABLE, finishedAt: new Date() } });
      await db.lead.updateMany({ where: { id: leadId, status: "RESEARCHING" }, data: { status: "NEW" } });
    }
    log.warn("run.enqueue_recovered", { runId: job.runId, ref: runRef(job.runId), phase: job.phase, outcome: onFail });
    throw new RunError(UNREACHABLE);
  }
}

async function ownedRun(runId: string, userId: string) {
  const run = await db.researchRun.findFirst({ where: { id: runId, requestedById: userId } });
  if (!run) throw new RunError("Run not found.");
  return run;
}

// A lead that was researched despite being screened out stays that way when its research is refreshed.
export async function startRun(leadId: string, userId: string, opts: { bypassScreen?: boolean; forMemberId?: string | null } = {}) {
  const lead = await db.lead.findFirst({ where: { id: leadId, createdById: userId } });
  if (!lead) throw new RunError("Lead not found.");

  const catalogue = await getActiveCatalogue();
  const previous = await db.researchRun.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" }, select: { screenBypassed: true, forMemberId: true } });
  const screenBypassed = !!opts.bypassScreen || !!previous?.screenBypassed;
  // The teammate the brief is written for; an id that is not on the team is ignored.
  const wanted = opts.forMemberId === undefined ? previous?.forMemberId : opts.forMemberId;
  const forMemberId = (wanted && (await db.teamProfile.findFirst({ where: { id: wanted, lastRefreshedAt: { not: null } }, select: { id: true } }))?.id) || null;

  // The lock makes a double click, or two tabs, resolve to a single run instead of two parallel ones.
  const { runId, created } = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${leadId}))`;
    const existing = await tx.researchRun.findFirst({ where: { leadId, status: { in: [...ACTIVE] } }, select: { id: true } });
    if (existing) return { runId: existing.id, created: false };
    const run = await tx.researchRun.create({
      data: {
        leadId,
        requestedById: userId,
        catalogueId: catalogue?.id ?? null,
        screenBypassed,
        forMemberId,
        limits: limitsFromEnv() as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await tx.lead.update({ where: { id: leadId }, data: { status: "RESEARCHING" } });
    return { runId: run.id, created: true };
  });

  log.info(created ? "run.created" : "run.reused", { runId, ref: runRef(runId), leadId, userId, catalogue: !!catalogue });
  if (created) await enqueueOrRecover({ runId, phase: "identify" }, leadId, "restart");
  return runId;
}

// A lead the rules could not settle waits for a person; approving it carries on with identification and research.
export async function approveRun(runId: string, userId: string) {
  const run = await ownedRun(runId, userId);
  if (run.status !== "AWAITING_APPROVAL") throw new RunError("This lead is not waiting for approval.");
  const moved = await db.researchRun.updateMany({ where: { id: runId, status: "AWAITING_APPROVAL" }, data: { status: "QUEUED", stage: "Approved. Starting research", error: null } });
  log.info("run.approved", { runId, ref: runRef(runId), userId, moved: moved.count === 1 });
  if (moved.count === 1) await enqueueOrRecover({ runId, phase: "approved" }, run.leadId, "approval");
}

export async function rejectRun(runId: string, userId: string) {
  const run = await ownedRun(runId, userId);
  const moved = await db.researchRun.updateMany({ where: { id: runId, status: "AWAITING_APPROVAL" }, data: { status: "SCREENED_OUT", stage: "Rejected after review. The brief was not built", finishedAt: new Date() } });
  log.info("run.rejected", { runId, ref: runRef(runId), userId, moved: moved.count === 1 });
  if (moved.count === 1) await db.lead.update({ where: { id: run.leadId }, data: { status: "NEW" } });
  else throw new RunError("This lead is not waiting for approval.");
}

// Starts over from the beginning, whatever state the current run is in.
export async function restartRun(leadId: string, userId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, createdById: userId }, select: { id: true } });
  if (!lead) throw new RunError("Lead not found.");
  const stopped = await db.researchRun.updateMany({ where: { leadId, status: { in: [...ACTIVE] } }, data: { status: "CANCELLED", stage: null, finishedAt: new Date() } });
  log.info("run.restarted", { leadId, userId, stopped: stopped.count });
  return startRun(leadId, userId);
}

// Removes every run and brief for the lead, which goes back to the list as new. Anything still running finds its run gone and stops.
export async function deleteBrief(leadId: string, userId: string) {
  const lead = await db.lead.findFirst({ where: { id: leadId, createdById: userId }, select: { id: true } });
  if (!lead) throw new RunError("Lead not found.");
  const removed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${leadId}))`;
    const res = await tx.researchRun.deleteMany({ where: { leadId } });
    await tx.lead.update({ where: { id: leadId }, data: { status: "NEW" } });
    return res.count;
  });
  log.info("run.brief_deleted", { leadId, userId, runs: removed });
}

// Removes the lead with its runs, briefs and photo (they cascade). Anything still running finds its run gone and stops.
export async function deleteLead(leadId: string, userId: string) {
  const res = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${leadId}))`;
    return tx.lead.deleteMany({ where: { id: leadId, createdById: userId } });
  });
  if (res.count === 0) throw new RunError("Lead not found.");
  log.info("lead.deleted", { leadId, userId });
}

export async function confirmCandidate(runId: string, userId: string, candidateId: string) {
  const run = await ownedRun(runId, userId);
  if (run.status !== "AWAITING_CONFIRMATION") throw new RunError("This run is not waiting for a choice.");
  const candidate = await db.identityCandidate.findFirst({ where: { id: candidateId, runId } });
  if (!candidate) throw new RunError("That person is not one of the options.");
  const moved = await db.researchRun.updateMany({ where: { id: runId, status: "AWAITING_CONFIRMATION" }, data: { selectedCandidateId: candidate.id, identityConfirmed: true, status: "QUEUED", stage: "Starting research", error: null } });
  log.info("run.confirmed", { runId, ref: runRef(runId), userId, moved: moved.count === 1 });
  if (moved.count === 1) await enqueueOrRecover({ runId, phase: "research" }, run.leadId, "wait");
}

// Used when no individual can be identified: research the organisation only.
export async function continueWithoutPerson(runId: string, userId: string) {
  const run = await ownedRun(runId, userId);
  if (run.status !== "AWAITING_CONFIRMATION") throw new RunError("This run is not waiting for a choice.");
  const moved = await db.researchRun.updateMany({ where: { id: runId, status: "AWAITING_CONFIRMATION" }, data: { selectedCandidateId: null, status: "QUEUED", stage: "Starting research", error: null } });
  log.info("run.continued_without_person", { runId, ref: runRef(runId), userId, moved: moved.count === 1 });
  if (moved.count === 1) await enqueueOrRecover({ runId, phase: "research" }, run.leadId, "wait");
}

export async function cancelRun(runId: string, userId: string) {
  const run = await ownedRun(runId, userId);
  const moved = await db.researchRun.updateMany({ where: { id: runId, status: { in: [...ACTIVE] } }, data: { status: "CANCELLED", stage: null, finishedAt: new Date() } });
  log.info("run.cancelled", { runId, ref: runRef(runId), userId, moved: moved.count === 1 });
  if (moved.count === 1) await db.lead.update({ where: { id: run.leadId }, data: { status: "NEW" } });
}

export async function rateBrief(runId: string, userId: string, rating: number, note: string | null) {
  await ownedRun(runId, userId);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new RunError("Choose a rating from 1 to 5.");
  const brief = await db.brief.findUnique({ where: { runId } });
  if (!brief) throw new RunError("There is no brief to rate yet.");
  await db.brief.update({ where: { runId }, data: { rating, ratingNote: note?.trim().slice(0, 1000) || null, ratedAt: new Date() } });
}

export async function researchAnyway(leadId: string, userId: string) {
  const latest = await db.researchRun.findFirst({ where: { leadId, requestedById: userId }, orderBy: { createdAt: "desc" }, select: { status: true } });
  if (latest?.status !== "SCREENED_OUT") throw new RunError("This lead was not screened out.");
  return startRun(leadId, userId, { bypassScreen: true });
}

const MAX_NOTE = 1000;

// The system's recommendation is kept as it was; the person's call is stored beside it with their reason.
export async function overrideDecision(runId: string, userId: string, decision: QualDecision | null, note: string | null) {
  const run = await ownedRun(runId, userId);
  if (!run.decision || !["COMPLETE", "PARTIAL"].includes(run.status)) throw new RunError("There is no finished brief to change the decision on.");
  if (decision === null) {
    await db.researchRun.update({ where: { id: runId }, data: { overrideDecision: null, overrideNote: null, overriddenById: null, overriddenAt: null } });
    log.info("run.override_cleared", { runId, ref: runRef(runId), userId });
    return;
  }
  const reason = note?.trim().slice(0, MAX_NOTE) ?? "";
  if (decision === run.decision) throw new RunError("That is already the recommendation. Choose a different decision to override it.");
  if (reason.length < 3) throw new RunError("Add a short reason, so the team can see why the recommendation was changed.");
  await db.researchRun.update({ where: { id: runId }, data: { overrideDecision: decision, overrideNote: reason, overriddenById: userId, overriddenAt: new Date() } });
  log.info("run.overridden", { runId, ref: runRef(runId), userId, from: run.decision, to: decision });
}
