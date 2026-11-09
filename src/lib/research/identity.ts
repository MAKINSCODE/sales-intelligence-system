import { emailHint, hostOf, quoteSupported, searchTerm } from "./policy";
import { BudgetExceeded } from "./budget";
import { IDENTITY_INSTRUCTIONS, identityResultSchema, type IdentityResult } from "./identity-schema";
import type { Providers, SearchHit } from "./types";

export type LeadInput = {
  firstName: string;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  profileUrl: string | null;
  email: string | null;
  country: string | null;
  enquiryText: string | null;
};

export type Confidence = "STRONG" | "POSSIBLE" | "WEAK";

export type ScoredCandidate = {
  name: string;
  headline: string | null;
  location: string | null;
  confidence: Confidence;
  matches: string[];
  mismatches: string[];
  signals: string[];
  sourceIds: string[];
  quote: string | null;
};

export type IdentityOutcome =
  | { kind: "candidates"; candidates: ScoredCandidate[]; autoSelect: number | null; hits: SearchHit[]; queries: string[]; note: string | null }
  | { kind: "not_identifiable"; reason: string };

const LEGAL_SUFFIX = new Set(["ltd", "limited", "llc", "inc", "plc", "gmbh", "corp", "corporation", "co", "company", "sa", "ag", "bv", "srl", "spa", "pty", "llp"]);

// Diacritics and case are ignored so "Jāmes" matches "James".
export const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const words = (s: string, min = 2) =>
  plain(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= min && !LEGAL_SUFFIX.has(w));

const hasAll = (hay: string, needle: string | null) => {
  const w = needle ? words(needle) : [];
  return w.length > 0 && w.every((x) => hay.includes(x));
};

const normUrl = (u: string) => {
  try {
    const p = new URL(u);
    return `${p.hostname.replace(/^www\./, "")}${p.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

export const personName = (l: Pick<LeadInput, "firstName" | "lastName">) => [l.firstName, l.lastName].filter(Boolean).join(" ");

export function checkIdentifiable(lead: LeadInput): string | null {
  if (!lead.lastName?.trim()) {
    return "Only a first name was provided, so no individual can be identified. You can continue with company information, or add a surname and try again.";
  }
  return null;
}

export function buildIdentityQueries(lead: LeadInput): string[] {
  const name = `"${searchTerm(personName(lead))}"`;
  const hint = emailHint(lead.email);
  const queries: string[] = [];

  const context = [lead.company, lead.jobTitle, lead.country].filter((v): v is string => !!v).map((v) => searchTerm(v, 80)).filter(Boolean).join(" ");
  queries.push(`${name} ${context}`.trim());
  if (hint.organisationDomain) queries.push(`${name} ${hint.organisationDomain}`);
  if (lead.profileUrl) queries.push(`${name} ${normUrl(lead.profileUrl)}`);
  if (queries.length === 1 && !context) queries.push(`${name} professional profile`);

  return [...new Set(queries)].slice(0, 3);
}

export function scoreCandidate(lead: LeadInput, c: IdentityResult["candidates"][number], hits: Map<string, SearchHit>): ScoredCandidate {
  const cited = c.sourceIds.map((id) => hits.get(id)).filter((h): h is SearchHit => !!h);
  const hay = plain([c.headline ?? "", c.location ?? "", ...cited.flatMap((h) => [h.title, h.snippet, h.url])].join(" "));
  const domain = emailHint(lead.email).organisationDomain;

  const urlMatch = !!lead.profileUrl && cited.some((h) => normUrl(h.url) === normUrl(lead.profileUrl!));
  const domainMatch = !!domain && cited.some((h) => hostOf(h.url) === domain || hostOf(h.url)?.endsWith(`.${domain}`) || plain(h.snippet).includes(domain));
  const companyMatch = hasAll(hay, lead.company);
  const titleWords = lead.jobTitle ? words(lead.jobTitle, 3) : [];
  const titleMatch = titleWords.length > 0 && titleWords.filter((w) => hay.includes(w)).length >= Math.ceil(titleWords.length / 2);
  const countryMatch = hasAll(hay, lead.country);

  const signals = [
    urlMatch && "profile link",
    domainMatch && "email domain",
    companyMatch && "company",
    titleMatch && "job title",
    countryMatch && "country",
  ].filter((s): s is string => !!s);

  const strong = [urlMatch, domainMatch, companyMatch].filter(Boolean).length;
  const soft = [titleMatch, countryMatch].filter(Boolean).length;
  let confidence: Confidence = "WEAK";
  if (urlMatch || strong >= 2 || (strong >= 1 && soft >= 1)) confidence = "STRONG";
  else if (strong >= 1 || soft >= 1) confidence = "POSSIBLE";
  // Evidence against the lead's details lowers confidence by a level.
  if (c.mismatches.length > 0) confidence = confidence === "STRONG" ? "POSSIBLE" : "WEAK";

  const quote = c.quote && quoteSupported(c.quote, cited.map((h) => `${h.title}\n${h.snippet}`).join("\n")) ? c.quote : null;

  return {
    name: c.name,
    headline: c.headline,
    location: c.location,
    confidence,
    matches: c.matches,
    mismatches: c.mismatches,
    signals,
    sourceIds: cited.map((h) => h.id),
    quote,
  };
}

const RANK: Record<Confidence, number> = { STRONG: 2, POSSIBLE: 1, WEAK: 0 };

export function formatLeadForPrompt(lead: LeadInput) {
  const hint = emailHint(lead.email);
  return [
    `Name: ${personName(lead)}`,
    lead.company && `Company: ${lead.company}`,
    lead.jobTitle && `Job title: ${lead.jobTitle}`,
    lead.country && `Country: ${lead.country}`,
    lead.profileUrl && `Profile link supplied: ${lead.profileUrl}`,
    hint.organisationDomain && `Email domain (organisation hint only): ${hint.organisationDomain}`,
    hint.sharedMailbox && "The email is a shared mailbox, not a personal address.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function resolveIdentity(lead: LeadInput, providers: Providers): Promise<IdentityOutcome> {
  const blocked = checkIdentifiable(lead);
  if (blocked) return { kind: "not_identifiable", reason: blocked };

  const queries = buildIdentityQueries(lead);
  const byId = new Map<string, SearchHit>();
  for (const [i, q] of queries.entries()) {
    try {
      const hits = await providers.search.search(q, { maxResults: 6 });
      for (const h of hits) if (!byId.has(h.id)) byId.set(h.id, h);
    } catch (e) {
      // Out of budget after at least one search: carry on with what was found.
      if (e instanceof BudgetExceeded && i > 0) break;
      throw e;
    }
  }

  const hits = [...byId.values()].sort((a, b) => b.score - a.score).slice(0, 14);
  if (hits.length === 0) return { kind: "candidates", candidates: [], autoSelect: null, hits, queries, note: "No public results were found for this name." };
  const index = new Map(hits.map((h) => [h.id, h]));

  const results = hits.map((h) => `[id: ${h.id}]\nTitle: ${h.title}\nURL: ${h.url}\nText: ${h.snippet}`).join("\n\n");
  const { value } = await providers.llm.structured({
    name: "identity",
    schema: identityResultSchema,
    instructions: IDENTITY_INSTRUCTIONS,
    input: `Lead input:\n${formatLeadForPrompt(lead)}\n\nSearch results:\n${results}`,
    maxOutputTokens: 1800,
  });

  const nameWords = words(personName(lead));
  const candidates = value.candidates
    .filter((c) => nameWords.every((w) => plain(c.name).includes(w)))
    .map((c) => scoreCandidate(lead, c, index))
    .filter((c) => c.sourceIds.length > 0)
    .sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);

  const strong = candidates.filter((c) => c.confidence === "STRONG");
  const rivals = candidates.filter((c) => c.confidence !== "WEAK");
  const autoSelect = strong.length === 1 && rivals.length === 1 ? candidates.indexOf(strong[0]) : null;

  return { kind: "candidates", candidates, autoSelect, hits, queries, note: value.note };
}
