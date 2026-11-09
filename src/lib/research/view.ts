import "server-only";
import { db } from "@/lib/db";
import { leadPhotoUrl } from "@/lib/format";
import type { Decision, Rule } from "@/lib/qualification/rules";
import { emailHint } from "./policy";

export type ClaimView = {
  id: string;
  section: "WHO" | "CONNECTIONS" | "NOW" | "ACTIVITY" | "CONVERSATION" | "QUALIFICATION";
  kind: "FACT" | "COLLECTED" | "PROVIDED" | "POTENTIAL" | "HYPOTHESIS" | "UNAVAILABLE";
  statement: string;
  quote: string | null;
  eventDate: string | null;
  detail: Record<string, unknown> | null;
  // Set once a person has changed or removed it; the wording they replaced is kept.
  hidden: boolean;
  edited: boolean;
  originalStatement: string | null;
  source: { id: string; url: string | null; domain: string | null; title: string | null; publishedAt: string | null; retrievedAt: string; kind: "SEARCH_RESULT" | "PAGE" | "PROVIDED" | "SOCIAL_POST" | "COMPANY_PROFILE" | "JOB_LISTING" } | null;
};

export type LeadView = { id: string; name: string; company: string | null; jobTitle: string | null; email: string | null; country: string | null; profileUrl: string | null; photoUrl: string | null };

export type PostsCoverage = { profile: string | null; returned: number; kept: number; rejected: number } | null;

export type ConnectionsSummary = { totalLinks: number; membersWithLinks: number; teamSize: number; shown: number } | null;

// A change the assistant suggested to the call plan; nothing changes until the person applies it.
export type Proposal =
  | { id: string; status: "pending" | "applied" | "dismissed"; kind: "rewrite_point"; summary: string; claimId: string; statement: string; insight: string | null; objection: string | null; before: string }
  | { id: string; status: "pending" | "applied" | "dismissed"; kind: "set_gaps"; summary: string; gaps: string[]; before: string[] };

export type ChatMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; citations: string[]; proposals: Proposal[]; createdAt: string };

// Details the lead did not supply but public sources gave, shown beside what was provided.
export type FoundDetails = { company: string | null; jobTitle: string | null; country: string | null; profileUrl: string | null };

export type DecisionView = {
  system: Decision | null;
  final: Decision | null;
  rules: Rule[];
  reasons: string[];
  competitors: string[];
  // True when only the cheap pre-checks ran, so size, revenue and hiring were never looked at.
  screenedOnly: boolean;
  thresholds: { minEmployees: number; minRevenueUsdM: number } | null;
  override: { decision: Decision; note: string | null; at: string } | null;
};

export type CandidateView = {
  id: string;
  name: string;
  headline: string | null;
  location: string | null;
  confidence: "STRONG" | "POSSIBLE" | "WEAK";
  matches: string[];
  mismatches: string[];
  signals: string[];
  quote: string | null;
  sources: { url: string | null; title: string | null }[];
};

export type RunView = {
  id: string;
  status: "QUEUED" | "QUALIFYING" | "AWAITING_APPROVAL" | "IDENTIFYING" | "AWAITING_CONFIRMATION" | "RESEARCHING" | "WRITING" | "COMPLETE" | "PARTIAL" | "FAILED" | "CANCELLED" | "SCREENED_OUT";
  stage: string | null;
  error: string | null;
  unidentified: boolean;
  // True when there is a company, a work-email domain or an enquiry to build an organisation-level brief from.
  companyOnlyPossible: boolean;
  createdAt: string;
  finishedAt: string | null;
  usage: { searches: number; pages: number; llmCalls: number; seconds: number };
  limits: { searches: number; pages: number; llmCalls: number; seconds: number };
  candidates: CandidateView[];
  claims: ClaimView[];
  lead: LeadView;
  decision: DecisionView | null;
  found: FoundDetails;
  messages: ChatMessage[];
  // The teammate the brief is written for, and everyone it could be switched to.
  forMember: { id: string; name: string } | null;
  team: { id: string; name: string }[];
  brief: { gaps: string[]; partial: string[]; droppedUnsupported: number; rating: number | null; ratingNote: string | null; team: string[]; connections: ConnectionsSummary; catalogue: string | null; postsCoverage: PostsCoverage } | null;
};

const ACTIVE = new Set(["QUEUED", "QUALIFYING", "IDENTIFYING", "RESEARCHING", "WRITING"]);
export const isActiveStatus = (s: string) => ACTIVE.has(s);

export async function loadRunView(leadId: string, userId: string, runId?: string): Promise<RunView | null> {
  const run = await db.researchRun.findFirst({
    where: { leadId, requestedById: userId, ...(runId ? { id: runId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      lead: { include: { photo: { select: { fetchedAt: true } } } },
      brief: true,
      candidates: true,
      messages: { orderBy: { createdAt: "asc" } },
      claims: { include: { source: true }, orderBy: [{ section: "asc" }, { position: "asc" }] },
    },
  });
  if (!run) return null;

  const sourceIds = run.candidates.flatMap((c) => ((c.evidence as { sources?: string[] }).sources ?? []));
  const sources = sourceIds.length ? await db.source.findMany({ where: { id: { in: sourceIds } }, select: { id: true, url: true, title: true } }) : [];
  const byId = new Map(sources.map((s) => [s.id, s]));
  const teamRows = await db.teamProfile.findMany({ where: { lastRefreshedAt: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, fullName: true, linkedinUrl: true } });
  const team = teamRows.map((m) => ({ id: m.id, name: m.fullName ?? m.linkedinUrl }));
  const limits = run.limits as { maxSearches: number; maxPages: number; maxLlmCalls: number; maxSeconds: number };
  const order = { STRONG: 0, POSSIBLE: 1, WEAK: 2 } as const;
  const content = run.brief?.content as { gaps?: string[]; partial?: string[]; droppedUnsupported?: number; team?: { name: string }[]; connections?: ConnectionsSummary; catalogue?: { version: string } | null; postsCoverage?: PostsCoverage } | undefined;

  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    error: run.error,
    unidentified: run.unidentified,
    companyOnlyPossible: !!(run.lead.company || emailHint(run.lead.email).organisationDomain || run.lead.enquiryText),
    lead: { id: run.lead.id, name: [run.lead.firstName, run.lead.lastName].filter(Boolean).join(" "), company: run.lead.company, jobTitle: run.lead.jobTitle, email: run.lead.email, country: run.lead.country, profileUrl: run.lead.profileUrl, photoUrl: run.lead.photo ? leadPhotoUrl(run.lead.id, run.lead.photo.fetchedAt) : null },
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    usage: { searches: run.searches, pages: run.pagesFetched, llmCalls: run.llmCalls, seconds: Math.round(run.activeMs / 1000) },
    limits: { searches: limits.maxSearches, pages: limits.maxPages, llmCalls: limits.maxLlmCalls, seconds: limits.maxSeconds },
    candidates: [...run.candidates]
      .sort((a, b) => order[a.confidence] - order[b.confidence])
      .map((c) => {
        const ev = c.evidence as { signals?: string[]; quote?: string | null; sources?: string[] };
        return { id: c.id, name: c.name, headline: c.headline, location: c.location, confidence: c.confidence, matches: c.matches, mismatches: c.mismatches, signals: ev.signals ?? [], quote: ev.quote ?? null, sources: (ev.sources ?? []).map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ url: s.url, title: s.title })) };
      }),
    claims: run.claims.map((c) => ({
      id: c.id,
      section: c.section,
      kind: c.kind,
      statement: c.statement,
      quote: c.quote,
      eventDate: c.eventDate,
      detail: (c.detail as Record<string, unknown> | null) ?? null,
      hidden: c.hidden,
      edited: !!c.editedAt,
      originalStatement: c.originalStatement,
      source: c.source ? { id: c.source.id, kind: c.source.kind, url: c.source.url, domain: c.source.domain, title: c.source.title, publishedAt: c.source.publishedAt?.toISOString() ?? null, retrievedAt: c.source.retrievedAt.toISOString() } : null,
    })),
    forMember: team.find((m) => m.id === run.forMemberId) ?? null,
    team,
    decision: decisionOf(run),
    found: foundDetails(run.claims, run.candidates.find((c) => c.id === run.selectedCandidateId), byId),
    messages: run.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, citations: m.citations, proposals: (m.proposals as Proposal[] | null) ?? [], createdAt: m.createdAt.toISOString() })),
    brief: run.brief
      ? { gaps: content?.gaps ?? [], partial: content?.partial ?? [], droppedUnsupported: content?.droppedUnsupported ?? 0, rating: run.brief.rating, ratingNote: run.brief.ratingNote, team: (content?.team ?? []).map((m) => m.name), connections: content?.connections ?? null, catalogue: content?.catalogue?.version ?? null, postsCoverage: content?.postsCoverage ?? null }
      : null,
  };
}

function foundDetails(claims: { section: string; detail: unknown; hidden: boolean }[], chosen: { evidence: unknown } | undefined, urls: Map<string, { url: string | null }>): FoundDetails {
  const detailOf = (group: string) => (claims.find((c) => c.section === "WHO" && !c.hidden && (c.detail as { group?: string } | null)?.group === group)?.detail ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const current = detailOf("current");
  const sources = ((chosen?.evidence as { sources?: string[] } | undefined)?.sources ?? []).map((id) => urls.get(id)?.url ?? null);
  return { company: text(current.organisation), jobTitle: text(current.title), country: text(detailOf("location").place), profileUrl: sources.find((u): u is string => !!u && /linkedin\.com\/in\//i.test(u)) ?? null };
}

// The role public sources gave for a person, for lists that only have the lead's own details to show.
export function roleFromClaims(claims: { detail: unknown; hidden: boolean }[]): { company: string | null; jobTitle: string | null } {
  const d = (claims.find((c) => !c.hidden && (c.detail as { group?: string } | null)?.group === "current")?.detail ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return { company: text(d.organisation), jobTitle: text(d.title) };
}

type DecisionData = { rules?: Rule[]; reasons?: string[]; competitors?: string[]; screenedOnly?: boolean; thresholds?: { minEmployees: number; minRevenueUsdM: number } };

function decisionOf(run: { decision: Decision | null; decisionData: unknown; overrideDecision: Decision | null; overrideNote: string | null; overriddenAt: Date | null }): DecisionView | null {
  if (!run.decision) return null;
  const d = (run.decisionData as DecisionData | null) ?? {};
  return {
    system: run.decision,
    final: run.overrideDecision ?? run.decision,
    rules: d.rules ?? [],
    reasons: d.reasons ?? [],
    competitors: d.competitors ?? [],
    screenedOnly: d.screenedOnly ?? false,
    thresholds: d.thresholds ?? null,
    override: run.overrideDecision && run.overriddenAt ? { decision: run.overrideDecision, note: run.overrideNote, at: run.overriddenAt.toISOString() } : null,
  };
}
