import { z } from "zod";
import { quoteSupported } from "./policy";
import type { LlmProvider } from "./types";

export type EvidenceSource = { id: string; url: string | null; title: string | null; text: string; publishedAt: Date | null };

const t = z.string();
const nt = z.string().nullable();

const base = { quote: t.describe("A short passage copied exactly from the source that supports this entry"), sourceId: t };

export const profileFactsSchema = z.object({
  currentRole: z.object({ title: nt, organisation: nt, ...base }).nullable(),
  location: z.object({ place: t, ...base }).nullable(),
  education: z.array(z.object({ institution: t, qualification: nt, start: nt, end: nt, ...base })),
  employment: z.array(z.object({ organisation: t, title: nt, start: nt, end: nt, ...base })),
});

export const announcementsSchema = z.object({
  items: z.array(
    z.object({
      about: z.enum(["person", "company"]),
      statement: t.describe("One neutral sentence stating what was announced or reported"),
      date: nt.describe("Publication or event date as YYYY-MM-DD, YYYY-MM or YYYY; null if the source gives none"),
      ...base,
    }),
  ),
});

export type ProfileFacts = z.infer<typeof profileFactsSchema>;
export type Announcements = z.infer<typeof announcementsSchema>;

const RULES = `Rules:
- Use only the numbered sources below. Never use outside knowledge.
- Every entry needs a quote copied EXACTLY from the cited source (a short phrase or sentence, not a paraphrase) and that source's id.
- Only include information about the named person (or their organisation where asked). If a source is about someone else with the same name, ignore it.
- Do not guess dates, titles or places. Use null when the source does not state them.
- Dates are YYYY, YYYY-MM or YYYY-MM-DD, or "present" for ongoing roles.`;

export const PROFILE_INSTRUCTIONS = `Extract a professional profile of one person from public sources.\n${RULES}\n- "Remote" roles have no physical place: do not put one in location.`;
export const ANNOUNCEMENT_INSTRUCTIONS = `Extract recent announcements, appointments, launches or news about one person or their organisation.\n${RULES}\n- Include an item only if the source explicitly names the subject (the person or the organisation) in the text. Never include news about a different organisation, a whole sector, or a different country's regulator, even if the topic is similar.\n- Skip adverts, job listings and generic marketing copy. Prefer items with a stated date.`;

export const formatSources = (sources: EvidenceSource[], maxChars = 3000) =>
  sources
    .map((s) => `[source ${s.id}] ${s.title ?? "Untitled"}${s.url ? ` (${s.url})` : ""}${s.publishedAt ? ` published ${s.publishedAt.toISOString().slice(0, 10)}` : ""}\n${s.text.slice(0, maxChars)}`)
    .join("\n\n---\n\n");

export type Dropped = { reason: "unknown_source" | "quote_not_in_source"; entry: string };

const byId = (sources: EvidenceSource[]) => new Map(sources.map((s) => [s.id, s]));

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The same fact often appears in several sources; the first one found is kept so each fact is listed once.
const uniqueBy = <T,>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

function keep<T extends { quote: string; sourceId: string }>(entries: T[], sources: Map<string, EvidenceSource>, label: (e: T) => string, dropped: Dropped[]): T[] {
  return entries.filter((e) => {
    const src = sources.get(e.sourceId);
    if (!src) return dropped.push({ reason: "unknown_source", entry: label(e) }), false;
    if (!quoteSupported(e.quote, `${src.title ?? ""}\n${src.text}`)) return dropped.push({ reason: "quote_not_in_source", entry: label(e) }), false;
    return true;
  });
}

export function validateProfileFacts(facts: ProfileFacts, sources: EvidenceSource[]) {
  const map = byId(sources);
  const dropped: Dropped[] = [];
  // A role with neither title nor organisation says nothing, so it is never presented as a verified fact.
  const [currentRole] = facts.currentRole && (facts.currentRole.title || facts.currentRole.organisation) ? keep([facts.currentRole], map, (e) => `role ${e.title}`, dropped) : [];
  const [location] = facts.location ? keep([facts.location], map, (e) => `location ${e.place}`, dropped) : [];
  return {
    value: {
      currentRole: currentRole ?? null,
      location: location ?? null,
      education: uniqueBy(keep(facts.education, map, (e) => `education ${e.institution}`, dropped), (e) => `${fold(e.institution)}|${e.start ?? ""}|${e.end ?? ""}`),
      employment: uniqueBy(keep(facts.employment, map, (e) => `employment ${e.organisation}`, dropped), (e) => `${fold(e.organisation)}|${fold(e.title ?? "")}|${e.start ?? ""}|${e.end ?? ""}`),
    } satisfies ProfileFacts,
    dropped,
  };
}

export function validateAnnouncements(a: Announcements, sources: EvidenceSource[]) {
  const dropped: Dropped[] = [];
  return { value: keep(a.items, byId(sources), (e) => `announcement ${e.statement.slice(0, 40)}`, dropped), dropped };
}

export async function extractProfileFacts(person: string, hint: string, sources: EvidenceSource[], llm: LlmProvider) {
  if (sources.length === 0) return { value: validateProfileFacts({ currentRole: null, location: null, education: [], employment: [] }, []).value, dropped: [] as Dropped[] };
  const { value } = await llm.structured({
    name: "profile_facts",
    schema: profileFactsSchema,
    instructions: PROFILE_INSTRUCTIONS,
    input: `Person: ${person}\n${hint}\n\nSources:\n${formatSources(sources)}`,
    maxOutputTokens: 2500,
  });
  return validateProfileFacts(value, sources);
}

export async function extractAnnouncements(subject: string, sources: EvidenceSource[], llm: LlmProvider) {
  if (sources.length === 0) return { value: [] as Announcements["items"], dropped: [] as Dropped[] };
  const { value } = await llm.structured({
    name: "announcements",
    schema: announcementsSchema,
    instructions: ANNOUNCEMENT_INSTRUCTIONS,
    input: `Subject: ${subject}\n\nSources:\n${formatSources(sources, 2000)}`,
    maxOutputTokens: 2000,
  });
  return validateAnnouncements(value, sources);
}

// For callers with their own entry shapes: keeps only entries whose quote really appears in the cited source.
export function validateQuoted<T extends { quote: string; sourceId: string }>(entries: T[], sources: EvidenceSource[], label: (e: T) => string) {
  const dropped: Dropped[] = [];
  return { value: keep(entries, byId(sources), label, dropped), dropped };
}
