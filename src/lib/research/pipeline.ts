import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log, runRef, withLogContext } from "@/lib/log";
import type { CatalogueData } from "@/lib/catalogue/parse";
import { loadTeam } from "@/lib/team/service";
import { decide, type Intent } from "@/lib/qualification/rules";
import { getSettings } from "@/lib/qualification/settings";
import { Budget, BudgetExceeded, withBudget } from "./budget";
import { BASE_THEMES, rankMembers, type LeadPost } from "./team-links";
import { extractAnnouncements, extractProfileFacts, type EvidenceSource, type ProfileFacts } from "./evidence";
import { formatLeadForPrompt, resolveIdentity, personName, type LeadInput } from "./identity";
import { canonicalProfileUrl, emailHint, isFetchable, mentionsSubject, parseDate, searchTerm } from "./policy";
import { WHO_FOR_QUESTION, composeConversation, saveConversation } from "./conversation";
import { collectActivity, profileFor } from "./activity";
import { profileSourceText } from "./profile-source";
import { collectPhoto } from "./photo";
import { classifyEnquiry } from "./company-evidence";
import { collectCompanyIntel } from "./company-intel";
import { findDecisionMakers } from "./decision-makers";
import { buildTeamConnections, leadItemsFromCompany, leadItemsFromFacts, summariseTeamFit, type MemberFit, type TeamFitResult } from "./team-fit";
import type { Limits, Providers } from "./types";

const TERMINAL = new Set(["COMPLETE", "PARTIAL", "FAILED", "CANCELLED", "SCREENED_OUT"]);

export function limitsFromEnv(): Limits {
  const e = env();
  return {
    maxSeconds: e.RESEARCH_MAX_SECONDS,
    maxSearches: e.RESEARCH_MAX_SEARCHES,
    maxPages: e.RESEARCH_MAX_PAGES,
    maxLlmCalls: e.RESEARCH_MAX_LLM_CALLS,
    maxPostRuns: e.RESEARCH_MAX_POST_RUNS,
    maxPosts: e.RESEARCH_MAX_POSTS,
    maxInputTokensPerCall: 24_000,
    maxOutputTokensPerCall: 4_000,
  };
}

type RunWithLead = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

const loadRun = (id: string) => db.researchRun.findUnique({ where: { id }, include: { lead: true } });

const toLeadInput = (l: RunWithLead["lead"]): LeadInput => ({
  firstName: l.firstName,
  lastName: l.lastName,
  company: l.company,
  jobTitle: l.jobTitle,
  profileUrl: l.profileUrl,
  email: l.email,
  country: l.country,
  enquiryText: l.enquiryText,
});

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function isCancelled(runId: string) {
  const r = await db.researchRun.findUnique({ where: { id: runId }, select: { status: true } });
  return !r || r.status === "CANCELLED";
}

// The deadline counts only active work, so time spent waiting for the user to confirm is free.
function makeBudget(run: RunWithLead) {
  return new Budget(run.limits as Limits, Date.now() - run.activeMs, {
    searches: run.searches,
    pagesFetched: run.pagesFetched,
    llmCalls: run.llmCalls,
    postRuns: run.postRuns,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  });
}

function usagePersister(runId: string, budget: Budget, baseActiveMs: number, phaseStart: number, carriedPostRuns = 0) {
  return async () => {
    const u = budget.usage;
    await db.researchRun
      .updateMany({
        where: { id: runId, status: { notIn: ["CANCELLED"] } },
        data: { searches: u.searches, pagesFetched: u.pagesFetched, llmCalls: u.llmCalls, postRuns: carriedPostRuns + u.postRuns, inputTokens: u.inputTokens, outputTokens: u.outputTokens, activeMs: baseActiveMs + (Date.now() - phaseStart) },
      })
      .catch(() => undefined);
  };
}

async function setStage(runId: string, status: "QUALIFYING" | "IDENTIFYING" | "RESEARCHING" | "WRITING", stage: string) {
  await db.researchRun.updateMany({ where: { id: runId, status: { not: "CANCELLED" } }, data: { status, stage } });
}

async function finish(runId: string, status: "COMPLETE" | "PARTIAL" | "FAILED" | "AWAITING_CONFIRMATION" | "AWAITING_APPROVAL" | "SCREENED_OUT", data: { stage?: string | null; error?: string | null } = {}) {
  const done = status !== "AWAITING_CONFIRMATION" && status !== "AWAITING_APPROVAL";
  log.info("run.status", { status, stage: data.stage ?? undefined, error: data.error ?? undefined });
  await db.researchRun.updateMany({
    where: { id: runId, status: { not: "CANCELLED" } },
    data: { status, stage: data.stage ?? null, error: data.error ?? null, ...(done ? { finishedAt: new Date() } : {}) },
  });
}

export type IdentifyResult = "research" | "wait" | "stop";

// Cheap checks on what the lead submitted, before any paid research. Only hard rules can stop a run here.
async function screenLead(lead: LeadInput, providers: Providers) {
  let intent: Intent | null = null;
  if (lead.enquiryText?.trim()) {
    try {
      intent = await classifyEnquiry(lead.enquiryText, providers.llm);
    } catch (e) {
      log.error("run.screen.intent_failed", { err: e });
    }
  }
  const settings = await getSettings();
  const outcome = decide({ email: lead.email, enquiryText: lead.enquiryText, intent, employees: null, revenueUsdM: null, exceptionSector: null }, settings);
  return { intent, outcome };
}

type Notes = { partial: string[]; dropped: number; irrelevant: number };

// Sends a lead back to the list without a brief; the person can still choose to research it anyway.
async function rejectLead(run: { id: string; leadId: string }, stage: string) {
  await finish(run.id, "SCREENED_OUT", { stage });
  await db.lead.update({ where: { id: run.leadId }, data: { status: "NEW" } });
}

async function identify(runId: string, raw: Providers): Promise<IdentifyResult> {
  const run = await loadRun(runId);
  if (!run || TERMINAL.has(run.status)) return "stop";

  const phaseStart = Date.now();
  const budget = makeBudget(run);
  const providers = withBudget(raw, budget, usagePersister(runId, budget, run.activeMs, phaseStart));
  await db.researchRun.update({ where: { id: runId }, data: { status: "IDENTIFYING", stage: "Checking the enquiry", startedAt: run.startedAt ?? new Date(), deadlineAt: budget.deadlineAt } });

  try {
    const screen = await screenLead(toLeadInput(run.lead), providers);
    log.info("run.screen", { decision: screen.outcome.decision, intent: screen.intent ?? undefined, bypassed: run.screenBypassed });
    const disqualified = screen.outcome.decision === "DISQUALIFIED";
    await db.researchRun.updateMany({
      where: { id: runId, status: { not: "CANCELLED" } },
      data: { decision: disqualified ? "DISQUALIFIED" : null, decisionData: json({ intent: screen.intent, rules: screen.outcome.rules, reasons: screen.outcome.reasons, screenedOnly: true, competitors: [] }) },
    });
    if (disqualified && !run.screenBypassed) {
      await rejectLead(run, "Disqualified before any research was done");
      return "stop";
    }
    await setStage(runId, "IDENTIFYING", "Searching for the right person");

    const outcome = await resolveIdentity(toLeadInput(run.lead), providers);
    if (await isCancelled(runId)) return "stop";
    log.info("run.identify.outcome", outcome.kind === "candidates" ? { kind: outcome.kind, candidates: outcome.candidates.length, confidence: outcome.candidates.map((c) => c.confidence), autoSelect: outcome.autoSelect !== null } : { kind: outcome.kind });

    if (outcome.kind === "not_identifiable") {
      await finish(runId, "AWAITING_CONFIRMATION", { stage: outcome.reason });
      return "wait";
    }

    await db.$transaction(async (tx) => {
      await tx.identityCandidate.deleteMany({ where: { runId } });
      await tx.source.deleteMany({ where: { runId } });
      const idMap = new Map<string, string>();
      for (const hit of outcome.hits) {
        const row = await tx.source.create({
          data: { runId, kind: "SEARCH_RESULT", url: hit.url, domain: new URL(hit.url).hostname.replace(/^www\./, ""), title: hit.title, publishedAt: parseDate(hit.publishedDate), text: `${hit.title}\n${hit.snippet}`, query: outcome.queries[0] },
          select: { id: true },
        });
        idMap.set(hit.id, row.id);
      }
      for (const c of outcome.candidates) {
        await tx.identityCandidate.create({
          data: {
            runId,
            name: c.name,
            headline: c.headline,
            location: c.location,
            confidence: c.confidence,
            matches: c.matches,
            mismatches: c.mismatches,
            evidence: json({ signals: c.signals, quote: c.quote, sources: c.sourceIds.map((id) => idMap.get(id)).filter(Boolean) }),
          },
        });
      }
    });

    if (outcome.autoSelect !== null) {
      const chosen = outcome.candidates[outcome.autoSelect];
      const row = await db.identityCandidate.findFirst({ where: { runId, name: chosen.name, headline: chosen.headline }, select: { id: true } });
      await db.researchRun.update({ where: { id: runId }, data: { selectedCandidateId: row?.id ?? null } });
      return "research";
    }
    await finish(runId, "AWAITING_CONFIRMATION", { stage: outcome.note ?? (outcome.candidates.length === 0 ? "No clear match was found. Add detail or continue with company information only." : "Choose the right person to continue.") });
    return "wait";
  } catch (e) {
    if (await isCancelled(runId)) return "stop";
    log.error("run.identify.failed", { err: e });
    await finish(runId, "FAILED", { error: e instanceof BudgetExceeded ? "The research limit was reached before the right person could be identified." : "Identification failed. Please try again." });
    return "stop";
  }
}

async function step<T>(name: string, notes: Notes, fallback: T, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  // Quoted search terms can hold personal details, so only the shape of the step name is logged.
  const label = name.replace(/"[^"]*"/g, '"…"');
  try {
    const result = await fn();
    log.info("run.step.ok", { step: label, ms: Date.now() - start });
    return result;
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      log.warn("run.step.limit", { step: label, limit: e.resource, ms: Date.now() - start });
      notes.partial.push(`Stopped early (${e.resource} limit) while ${name}.`);
    } else {
      log.error("run.step.failed", { step: label, ms: Date.now() - start, err: e });
      notes.partial.push(`Could not finish ${name}.`);
    }
    return fallback;
  }
}

const span = (s: string | null, e: string | null) => (s || e ? ` (${s ?? "?"} to ${e ?? "?"})` : "");

type ClaimDraft = Prisma.ClaimCreateManyInput;

function whoClaims(runId: string, lead: LeadInput, facts: ProfileFacts | null): ClaimDraft[] {
  const out: ClaimDraft[] = [];
  const provided = [
    lead.company && ["Company", lead.company],
    lead.jobTitle && ["Job title", lead.jobTitle],
    lead.country && ["Country", lead.country],
    lead.profileUrl && ["Profile link", lead.profileUrl],
  ].filter((x): x is string[] => !!x);
  for (const [label, value] of provided) out.push({ runId, section: "WHO", kind: "PROVIDED", statement: `${label}: ${value}`, position: out.length });

  if (facts?.currentRole) out.push({ runId, section: "WHO", kind: "FACT", statement: `${facts.currentRole.title ?? "Role not stated"} at ${facts.currentRole.organisation ?? "an organisation not stated"}`, sourceId: facts.currentRole.sourceId, quote: facts.currentRole.quote, detail: json({ group: "current", title: facts.currentRole.title, organisation: facts.currentRole.organisation }), position: out.length });
  if (facts?.location) out.push({ runId, section: "WHO", kind: "FACT", statement: `Based in ${facts.location.place}`, sourceId: facts.location.sourceId, quote: facts.location.quote, detail: json({ group: "location", place: facts.location.place }), position: out.length });
  for (const e of facts?.employment ?? []) out.push({ runId, section: "WHO", kind: "FACT", statement: `${e.title ? `${e.title} at ` : ""}${e.organisation}${span(e.start, e.end)}`, sourceId: e.sourceId, quote: e.quote, detail: json({ group: "career", ...e }), position: out.length });
  for (const e of facts?.education ?? []) out.push({ runId, section: "WHO", kind: "FACT", statement: `${e.qualification ? `${e.qualification}, ` : ""}${e.institution}${span(e.start, e.end)}`, sourceId: e.sourceId, quote: e.quote, detail: json({ group: "education", ...e }), position: out.length });

  if (!facts || out.every((c) => c.kind === "PROVIDED")) {
    out.push({ runId, section: "WHO", kind: "UNAVAILABLE", statement: "No career details could be verified from public sources. Only what was provided is shown.", position: out.length });
  }
  return out;
}

async function research(runId: string, raw: Providers, approved: boolean): Promise<void> {
  const run = await loadRun(runId);
  if (!run || TERMINAL.has(run.status)) return;

  const phaseStart = Date.now();
  // Collectors run afresh in this phase, so runs spent by an interrupted earlier attempt must not count against it.
  const budget = makeBudget({ ...run, postRuns: 0 });
  const saved = (run.decisionData ?? {}) as { intent?: Intent | null; facts?: ProfileFacts | null; partial?: string[]; collectorRuns?: number };
  // After an approval the company page and job collectors already ran; they count in the total shown, not against this phase's per-kind cap.
  const carriedRuns = approved ? (saved.collectorRuns ?? 0) : 0;
  const providers = withBudget(raw, budget, usagePersister(runId, budget, run.activeMs, phaseStart, carriedRuns));
  const lead = toLeadInput(run.lead);
  const person = personName(lead);
  const notes: Notes = { partial: approved ? [...(saved.partial ?? [])] : [], dropped: 0, irrelevant: 0 };

  const candidate = run.selectedCandidateId ? await db.identityCandidate.findUnique({ where: { id: run.selectedCandidateId } }) : null;
  const unidentified = !candidate;
  await db.researchRun.update({
    where: { id: runId },
    data: { status: approved ? "RESEARCHING" : "QUALIFYING", stage: approved ? "Researching the person and the organisation" : unidentified ? "Researching the organisation" : "Reading sources about this person", unidentified },
  });

  // Read fresh on every run, so an admin's changes to the team list apply to the next brief.
  const team = await loadTeam();
  const catalogueRow = run.catalogueId ? await db.companyCatalogue.findFirst({ where: { id: run.catalogueId, approved: true } }) : null;
  const catalogue = catalogueRow ? (catalogueRow.data as unknown as CatalogueData) : null;

  try {
    // The identity search results stay: the chosen person's evidence points at them. After an approval the person and company findings stay too.
    const identityRows = await db.identityCandidate.findMany({ where: { runId }, select: { evidence: true } });
    const keepSources = identityRows.flatMap((c) => (c.evidence as { sources?: string[] }).sources ?? []);
    await db.$transaction([
      db.claim.deleteMany({ where: { runId, ...(approved ? { section: { notIn: ["WHO", "QUALIFICATION"] } } : {}) } }),
      db.brief.deleteMany({ where: { runId } }),
      db.source.deleteMany({ where: { runId, id: { notIn: keepSources }, claims: { none: {} } } }),
    ]);

    // 1. Sources about the person: the identity search results, plus a few fetched pages.
    let facts: ProfileFacts | null = approved ? (saved.facts ?? null) : null;
    let personSources: EvidenceSource[] = [];
    if (candidate && !approved) {
      const ev = candidate.evidence as { sources?: string[] };
      const rows = await db.source.findMany({ where: { id: { in: ev.sources ?? [] } } });
      personSources = rows.map((s) => ({ id: s.id, url: s.url, title: s.title, text: s.text, publishedAt: s.publishedAt }));

      if (await isCancelled(runId)) return;
      const pages = await step("reading pages about the person", notes, [] as EvidenceSource[], async () => {
        const urls = rows.map((r) => r.url).filter((u): u is string => !!u && isFetchable(u)).slice(0, 3);
        if (urls.length === 0) return [];
        const fetched = await providers.search.extract(urls);
        const out: EvidenceSource[] = [];
        for (const p of fetched) {
          const row = await db.source.create({ data: { runId, kind: "PAGE", url: p.url, domain: new URL(p.url).hostname.replace(/^www\./, ""), title: rows.find((r) => r.url === p.url)?.title ?? null, text: p.text }, select: { id: true, title: true } });
          out.push({ id: row.id, url: p.url, title: row.title, text: p.text, publishedAt: null });
        }
        return out;
      });
      personSources = [...personSources, ...pages];

      // The person's LinkedIn details give the employer and role directly, but only for a profile that is theirs: the one the lead supplied, or one the person confirmed or a strong match.
      const confirmed = !!lead.profileUrl || run.identityConfirmed || candidate.confidence === "STRONG";
      const profileId = providers.profiles && confirmed ? await profileFor(runId, lead.profileUrl, ev.sources ?? []) : null;
      if (profileId) {
        const profileSources = await step("reading the LinkedIn profile", notes, [] as EvidenceSource[], async () => {
          const url = canonicalProfileUrl(profileId);
          const details = await providers.profiles!.fetchProfile(url);
          const text = profileSourceText(details);
          const row = await db.source.create({ data: { runId, kind: "PAGE", url, domain: "linkedin.com", title: `${details.fullName || person} on LinkedIn`, text }, select: { id: true, title: true } });
          return [{ id: row.id, url, title: row.title, text, publishedAt: null }];
        });
        personSources = [...personSources, ...profileSources];
      }

      facts = await step("extracting career details", notes, null as ProfileFacts | null, async () => {
        const r = await extractProfileFacts(person, formatLeadForPrompt(lead), personSources, providers.llm);
        notes.dropped += r.dropped.length;
        return r.value;
      });

      // Still no employer and none supplied: one more targeted search for where this person works.
      if (!facts?.currentRole?.organisation && !lead.company && !emailHint(lead.email).organisationDomain) {
        const extra = await step("looking for where this person works", notes, [] as EvidenceSource[], async () => {
          const q = `"${searchTerm(person)}" current job title company`;
          const hits = await providers.search.search(q, { maxResults: 5, topic: "general" });
          const out: EvidenceSource[] = [];
          for (const h of hits) {
            const text = `${h.title}\n${h.snippet}`;
            if (!mentionsSubject(text, h.url, { names: [person], domains: [] })) continue;
            const row = await db.source.create({ data: { runId, kind: "SEARCH_RESULT", url: h.url, domain: new URL(h.url).hostname.replace(/^www\./, ""), title: h.title, publishedAt: parseDate(h.publishedDate), text, query: q }, select: { id: true } });
            out.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
          }
          return out;
        });
        if (extra.length > 0) {
          personSources = [...personSources, ...extra];
          facts = await step("extracting career details", notes, facts, async () => {
            const r = await extractProfileFacts(person, formatLeadForPrompt(lead), personSources, providers.llm);
            notes.dropped += r.dropped.length;
            return r.value;
          });
        }
      }
    }

    // 2. What the sources say about the person fills in what the lead left out, so the qualification check judges the real company.
    const hint = emailHint(lead.email);
    const organisation = facts?.currentRole?.organisation ?? lead.company ?? hint.organisationDomain;
    if (!approved) {
      if (await isCancelled(runId)) return;
      await db.researchRun.update({ where: { id: runId }, data: { stage: "Checking the company" } });
      const settings = await getSettings();
      const intel = await collectCompanyIntel({ runId, organisation, domain: hint.organisationDomain, providers, settings, facts, step: (name, fallback, fn) => step(name, notes, fallback, fn) });
      const outcome = decide({ email: lead.email, enquiryText: lead.enquiryText, intent: saved.intent ?? null, employees: intel.employees, revenueUsdM: intel.revenueUsdM, exceptionSector: intel.exceptionSector, workplaceVerified: !!facts?.currentRole?.organisation }, settings);
      if (await isCancelled(runId)) return;

      await db.claim.createMany({ data: [...whoClaims(runId, lead, facts), ...intel.claims] });
      await db.researchRun.updateMany({
        where: { id: runId, status: { not: "CANCELLED" } },
        data: { decision: outcome.decision, decisionData: json({ intent: saved.intent ?? null, rules: outcome.rules, reasons: outcome.reasons, screenedOnly: false, competitors: intel.competitors, facts, partial: notes.partial, collectorRuns: budget.usage.postRuns, thresholds: { minEmployees: settings.minEmployees, minRevenueUsdM: settings.minRevenueUsdM } }) },
      });
      log.info("run.qualified", { decision: outcome.decision, bypassed: run.screenBypassed });

      // The person always reviews the recommendation before the costly research. A lead they already chose to research anyway skips the review.
      if (!run.screenBypassed) {
        const stage = outcome.decision === "QUALIFIED" ? "Meets the criteria. Choose whether to build the brief." : outcome.decision === "DISQUALIFIED" ? "The rules recommend not going on. Choose whether to build the brief anyway." : "Not enough is known to qualify this lead. Choose whether to build the brief.";
        await finish(runId, "AWAITING_APPROVAL", { stage });
        return;
      }
      await setStage(runId, "RESEARCHING", "Looking for recent announcements");
    }

    // 3. Recent news about the person and their organisation.
    if (await isCancelled(runId)) return;
    await db.researchRun.update({ where: { id: runId }, data: { stage: "Looking for recent announcements" } });
    const newsSources: EvidenceSource[] = [];
    const place = lead.country ? ` ${searchTerm(lead.country, 60)}` : "";
    const org = organisation ? searchTerm(organisation) : "";
    const queries = [org && `"${org}"${place} announcement news`, candidate && org && `"${searchTerm(person)}" "${org}"`].filter((q): q is string => !!q);
    const orgSubject = { names: [facts?.currentRole?.organisation, lead.company].filter((n): n is string => !!n), domains: hint.organisationDomain ? [hint.organisationDomain] : [] };
    const personSubject = { names: candidate ? [person] : [], domains: [] as string[] };
    for (const q of queries.slice(0, 2)) {
      await step(`searching "${q.slice(0, 40)}"`, notes, undefined, async () => {
        const hits = await providers.search.search(q, { maxResults: 5, topic: "news", timeRange: "year" });
        for (const h of hits) {
          if (newsSources.some((s) => s.url === h.url)) continue;
          // Generic sector news is dropped: a source must actually name the organisation or the person.
          const text = `${h.title}\n${h.snippet}`;
          if (!mentionsSubject(text, h.url, orgSubject) && !mentionsSubject(text, h.url, personSubject)) {
            notes.irrelevant++;
            continue;
          }
          const row = await db.source.create({ data: { runId, kind: "SEARCH_RESULT", url: h.url, domain: new URL(h.url).hostname.replace(/^www\./, ""), title: h.title, publishedAt: parseDate(h.publishedDate), text, query: q }, select: { id: true } });
          newsSources.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
        }
      });
    }
    const announcements = await step("extracting announcements", notes, [] as Awaited<ReturnType<typeof extractAnnouncements>>["value"], async () => {
      const r = await extractAnnouncements(organisation ? `${organisation}${candidate ? ` and ${person}` : ""}` : person, newsSources, providers.llm);
      notes.dropped += r.dropped.length;
      return r.value;
    });

    // 4. Persist the evidence-backed sections.
    if (await isCancelled(runId)) return;
    const claims: ClaimDraft[] = [];

    announcements.forEach((a, i) => claims.push({ runId, section: "NOW", kind: "FACT", statement: a.statement, sourceId: a.sourceId, quote: a.quote, eventDate: a.date, detail: json({ about: a.about }), position: i }));
    if (lead.enquiryText) claims.push({ runId, section: "NOW", kind: "PROVIDED", statement: lead.enquiryText.slice(0, 600), detail: json({ label: "Stated by the lead in their enquiry" }), position: announcements.length });
    if (announcements.length === 0 && !lead.enquiryText) claims.push({ runId, section: "NOW", kind: "UNAVAILABLE", statement: "No dated announcements were found for this person or organisation.", position: 0 });

    // Other senior people at the organisation, who may also decide on or influence a purchase.
    if (organisation) {
      const makers = await step("looking for other decision makers", notes, [] as Awaited<ReturnType<typeof findDecisionMakers>>, () => findDecisionMakers({ runId, organisation, domain: hint.organisationDomain, leadName: person, providers }));
      makers.forEach((m, i) => claims.push({ runId, section: "WHO", kind: "FACT", statement: `${m.name}, ${m.title}`, sourceId: m.sourceId, quote: m.quote, detail: json({ group: "decision_maker", name: m.name, title: m.title, organisation }), position: 100 + i }));
    }

    // Recent posts: only for a confirmed (or strongly matched) person, and only from their own confirmed profile.
    await db.researchRun.update({ where: { id: runId }, data: { stage: "Collecting recent posts" } });
    const strong = candidate?.confidence === "STRONG";
    const activity = await collectActivity({ runId, leadProfileUrl: lead.profileUrl, candidateSourceIds: ((candidate?.evidence as { sources?: string[] } | undefined)?.sources) ?? [], confirmed: !!candidate && (run.identityConfirmed || strong), providers });
    claims.push(...activity.claims);
    if (activity.partial) notes.partial.push(activity.partial);
    await collectPhoto({ leadId: run.leadId, profile: activity.profile, providers });
    const postsCoverage = activity.coverage;

    // Team connections: shared career ground and shared interests, summarised per team member.
    const postIds = activity.claims.map((c) => c.sourceId).filter((x): x is string => !!x);
    const postRows = postIds.length ? await db.source.findMany({ where: { id: { in: postIds } }, select: { id: true, text: true } }) : [];
    const postText = new Map(postRows.map((r) => [r.id, r.text]));
    const leadPosts: LeadPost[] = activity.claims.flatMap((c) => (c.sourceId && c.quote && postText.has(c.sourceId) ? [{ sourceId: c.sourceId, quote: c.quote, text: postText.get(c.sourceId)!, date: c.eventDate ?? null }] : []));
    const settings = await getSettings();
    const themes = [...new Set([...BASE_THEMES, ...settings.strongKeywords, ...settings.weakKeywords])];
    const ranking = rankMembers(team, facts, leadPosts, themes, Math.max(team.length, 1));
    const companyFacts = await db.claim.findMany({ where: { runId, section: "QUALIFICATION", kind: "FACT" }, select: { quote: true, sourceId: true } });
    const leadItems = [...leadPosts.map((p, i) => ({ id: `post-${i + 1}`, label: `post${p.date ? ` ${p.date}` : ""}`, text: p.text, sourceId: p.sourceId })), ...leadItemsFromFacts(facts), ...leadItemsFromCompany(companyFacts)];
    if (await isCancelled(runId)) return;
    const linkedIds = new Set(ranking.ranked.map((r) => r.member.id));
    const noFit: TeamFitResult = { members: new Map<string, MemberFit>(), commonGround: null };
    const fit = leadItems.length > 0 && team.length > 0 ? await step("comparing interests with the team", notes, noFit, () => summariseTeamFit(team, leadItems, providers.llm, linkedIds)) : noFit;
    const connections = buildTeamConnections(team, ranking, fit.members);
    if (team.length === 0) {
      claims.push({ runId, section: "CONNECTIONS", kind: "UNAVAILABLE", statement: "No team LinkedIn profiles have been read yet, so no common ground was checked. An admin can add them under Reference.", position: 0 });
    } else if (connections.length === 0) {
      const why = leadItems.length > 0 ? "No shared school, employer, place or interest was found between this person and any team member." : "Not enough verified career detail or posts to compare with the team's backgrounds.";
      claims.push({ runId, section: "CONNECTIONS", kind: "UNAVAILABLE", statement: why, position: 0 });
    }
    let linkPosition = 0;
    if (fit.commonGround && connections.length > 0) {
      const names = fit.commonGround.memberIds.map((id) => team.find((m) => m.id === id)?.name).filter((n): n is string => !!n);
      claims.push({ runId, section: "CONNECTIONS", kind: "POTENTIAL", statement: fit.commonGround.statement, detail: json({ commonGround: true, members: names }), position: linkPosition++ });
    }
    connections.forEach((c, rank) => {
      const base = { member: c.member.name, memberId: c.member.id, memberUrl: c.member.linkedinUrl, rank: rank + 1, memberLinks: c.links.length };
      if (c.summary) claims.push({ runId, section: "CONNECTIONS", kind: "POTENTIAL", statement: c.summary, detail: json({ ...base, summary: true, generated: c.generated, ties: c.ties }), sourceId: c.ties[0]?.leadSourceId ?? c.links[0]?.leadSourceId ?? null, quote: c.ties[0]?.leadQuote ?? c.links[0]?.leadQuote ?? null, position: linkPosition++ });
      for (const l of c.links) claims.push({ runId, section: "CONNECTIONS", kind: "POTENTIAL", statement: l.title, detail: json({ ...base, explanation: l.detail, overlap: l.overlap, kind: l.kind }), sourceId: l.leadSourceId, quote: l.leadQuote, position: linkPosition++ });
    });
    await db.claim.createMany({ data: claims });

    // 5. Conversation: every point must cite stored evidence.
    await setStage(runId, "WRITING", "Preparing the conversation");
    const subjectLabel = unidentified ? `an unidentified contact at ${organisation ?? "an unknown organisation"}` : person;
    const forMember = run.forMemberId ? (team.find((m) => m.id === run.forMemberId) ?? null) : null;
    const conversation = await step("preparing the conversation", notes, null, () => composeConversation({ runId, person: subjectLabel, unidentified, catalogue, forMember: forMember && { name: forMember.name, profile: forMember.profile }, llm: providers.llm }));
    await saveConversation(runId, conversation);
    if (conversation && !conversation.angle && conversation.triggers.length === 0) notes.partial.push("No grounded conversation points could be produced from the evidence.");

    if (await isCancelled(runId)) return;
    const usage = budget.usage;
    await db.brief.create({
      data: {
        runId,
        model: env().OPENAI_MODEL,
        content: json({
          gaps: conversation?.gaps ?? [],
          rejected: conversation?.rejected ?? [],
          partial: notes.partial,
          droppedUnsupported: notes.dropped,
          irrelevantSkipped: notes.irrelevant,
          postsCoverage,
          unidentified,
          team: team.map((m) => ({ name: m.name, url: m.linkedinUrl })),
          connections: { totalLinks: connections.reduce((s, c) => s + c.links.length + c.ties.length, 0), membersWithLinks: connections.length, teamSize: team.length, shown: connections.length },
          catalogue: catalogueRow ? { version: catalogueRow.version, approvedBy: catalogueRow.approvedBy } : null,
          usage,
        }),
      },
    });
    log.info("run.brief.saved", { claims: claims.length, partial: notes.partial.length, dropped: notes.dropped, irrelevant: notes.irrelevant, unidentified, usage });
    await usagePersister(runId, budget, run.activeMs, phaseStart, carriedRuns)();
    // With no teammate chosen yet, the assistant opens the conversation by asking.
    if (!forMember && team.length > 0) await db.briefMessage.create({ data: { runId, role: "ASSISTANT", content: WHO_FOR_QUESTION, citations: [] } });
    await db.researchRun.update({ where: { id: runId }, data: { lead: { update: { status: "READY" } } } });
    await finish(runId, notes.partial.length > 0 ? "PARTIAL" : "COMPLETE");
  } catch (e) {
    if (await isCancelled(runId)) return;
    log.error("run.research.failed", { err: e });
    await finish(runId, "FAILED", { error: "Research failed unexpectedly. Please try again." });
  }
}

// Every log line written while a phase runs carries the run id and its short reference.
const inRun = <T>(runId: string, phase: "identify" | "research", fn: () => Promise<T>) => withLogContext({ runId, ref: runRef(runId), phase }, fn);

// Screens the enquiry for free, then finds the person. The qualification check comes after, once public sources have filled in what the lead left out.
export function identifyPhase(runId: string, raw: Providers): Promise<IdentifyResult> {
  return inRun(runId, "identify", async () => {
    const start = Date.now();
    log.info("run.phase.start");
    const next = await identify(runId, raw);
    log.info("run.phase.done", { next, ms: Date.now() - start });
    return next;
  });
}

// `approved` continues a lead a person approved after the qualification check, reusing what that check already found.
export function researchPhase(runId: string, raw: Providers, opts: { approved?: boolean } = {}): Promise<void> {
  return inRun(runId, "research", async () => {
    const start = Date.now();
    log.info("run.phase.start");
    await research(runId, raw, !!opts.approved);
    log.info("run.phase.done", { ms: Date.now() - start });
  });
}
