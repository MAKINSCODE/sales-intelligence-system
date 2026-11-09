import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { sameName } from "./connections";
import { formatSources, validateQuoted, type EvidenceSource } from "./evidence";
import { mentionsSubject, parseDate, searchTerm } from "./policy";
import type { Providers } from "./types";

const decisionMakersSchema = z.object({
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      quote: z.string().describe("A short passage copied exactly from the source that names this person and their role"),
      sourceId: z.string(),
    }),
  ),
});

const INSTRUCTIONS = `List the senior people at one organisation who are likely to decide on or influence buying technology or AI projects: owners, chief executives, other C-level officers, directors, and heads of digital, IT, data, innovation or operations.
Rules:
- Use only the numbered sources below. Never use outside knowledge.
- Every entry needs the person's full name, their title at that organisation, a quote copied EXACTLY from the cited source, and that source's id.
- Only include people the source says work at the named organisation now. Skip former staff, board members of other organisations, and people with no stated title.
- Do not include the person named as the lead.
- At most 6 entries, most senior first.`;

export type DecisionMaker = { name: string; title: string; quote: string; sourceId: string };

// Other senior people at the lead's organisation, from public pages. Each needs a quote that really appears in its source.
export async function findDecisionMakers(args: { runId: string; organisation: string; domain: string | null; leadName: string; providers: Providers }): Promise<DecisionMaker[]> {
  const { runId, organisation, domain, leadName, providers } = args;
  const org = searchTerm(organisation);
  const query = `"${org}" leadership team executives directors`;
  const hits = await providers.search.search(query, { maxResults: 6, topic: "general" });
  const subject = { names: [organisation], domains: domain ? [domain] : [] };

  const sources: EvidenceSource[] = [];
  for (const h of hits) {
    const text = `${h.title}\n${h.snippet}`;
    if (!mentionsSubject(text, h.url, subject) || sources.some((s) => s.url === h.url)) continue;
    const row = await db.source.create({ data: { runId, kind: "SEARCH_RESULT", url: h.url, domain: new URL(h.url).hostname.replace(/^www\./, ""), title: h.title, publishedAt: parseDate(h.publishedDate), text, query }, select: { id: true } });
    sources.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
  }
  if (sources.length === 0) return [];

  const { value } = await providers.llm.structured({
    name: "decision_makers",
    schema: decisionMakersSchema,
    instructions: INSTRUCTIONS,
    input: `Organisation: ${organisation}\nLead (leave out): ${leadName}\n\nSources:\n${formatSources(sources, 2500)}`,
    maxOutputTokens: 1500,
  });

  const seen: string[] = [];
  return validateQuoted(value.people, sources, (p) => `decision maker ${p.name}`)
    .value.filter((p) => p.name.trim() && p.title.trim() && !sameName(p.name, leadName))
    .filter((p) => (seen.some((s) => sameName(s, p.name)) ? false : (seen.push(p.name), true)))
    .slice(0, 6);
}
