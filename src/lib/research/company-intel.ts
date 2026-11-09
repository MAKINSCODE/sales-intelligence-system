import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { QualSettings } from "@/lib/qualification/rules";
import { sameName } from "./connections";
import { extractCompanyFacts, inferCompetitors } from "./company-evidence";
import { extractAnnouncements, type EvidenceSource, type ProfileFacts } from "./evidence";
import { AI_ROLE } from "./apify-company";
import { hostOf, mentionsSubject, parseDate, searchTerm } from "./policy";
import type { Providers } from "./types";

type Claim = Prisma.ClaimCreateManyInput;
export type StepFn = <T>(name: string, fallback: T, fn: () => Promise<T>) => Promise<T>;

export type Intel = {
  claims: Claim[];
  employees: number | null;
  revenueUsdM: number | null;
  exceptionSector: string | null;
  competitors: string[];
};

const AI_TEXT = /\b(agentic|ai agents?|ai assistants?|ai-powered|ai-driven|generative ai|gen ?ai|llm|copilot|artificial intelligence|machine learning)\b/i;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const n = (v: number) => v.toLocaleString("en-GB");

const SOURCE_DOMAIN = (u: string | null) => (u ? hostOf(u) : null);

export function promotionSignal(facts: ProfileFacts, now = new Date()) {
  const cur = facts.currentRole;
  if (!cur?.organisation) return null;
  const starts = (s: string | null) => {
    const m = s?.match(/^(\d{4})(?:-(\d{2}))?$/);
    return m ? Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, 1) : null;
  };
  const here = facts.employment
    .filter((e) => e.title && starts(e.start) !== null && sameName(e.organisation, cur.organisation!))
    .sort((a, b) => starts(b.start)! - starts(a.start)!);
  const newest = here[0];
  const older = newest && here.find((e) => e.title!.toLowerCase() !== newest.title!.toLowerCase());
  if (!newest || !older) return null;
  const monthsAgo = (now.getTime() - starts(newest.start)!) / (30.44 * 86_400_000);
  if (monthsAgo > 18) return null;
  return { statement: `Moved from ${older.title} to ${newest.title} at ${cur.organisation} (from ${newest.start})`, quote: newest.quote, sourceId: newest.sourceId };
}

export async function collectCompanyIntel(args: {
  runId: string;
  organisation: string | null;
  domain: string | null;
  providers: Providers;
  settings: QualSettings;
  facts: ProfileFacts | null;
  step: StepFn;
}): Promise<Intel> {
  const { runId, organisation, domain, providers, settings, facts, step } = args;
  const claims: Claim[] = [];
  const add = (c: Omit<Claim, "runId" | "section" | "position">) => void claims.push({ runId, section: "QUALIFICATION", position: claims.length, ...c });
  const out: Intel = { claims, employees: null, revenueUsdM: null, exceptionSector: null, competitors: [] };

  // Promotion needs no organisation lookup, only the person's own verified career details.
  const promo = facts && promotionSignal(facts);
  if (promo) add({ kind: "FACT", statement: promo.statement, sourceId: promo.sourceId, quote: promo.quote, detail: json({ group: "contact", label: "Possible recent change of role" }) });

  if (!organisation) {
    add({ kind: "UNAVAILABLE", statement: "No organisation is known for this lead, so the company could not be checked.", detail: json({ group: "company" }) });
    return out;
  }
  const org = searchTerm(organisation);
  const subject = { names: [organisation], domains: domain ? [domain] : [] };
  const stored = (data: Omit<Prisma.SourceUncheckedCreateInput, "runId">) => db.source.create({ data: { runId, ...data }, select: { id: true } });
  const evidence: EvidenceSource[] = [];

  // 1. The company's LinkedIn page: headcount and sector as structured data.
  let linkedinUrl: string | null = null;
  if (providers.companies) {
    await step("looking up the company page", undefined, async () => {
      const info = await providers.companies!.lookup({ name: org });
      // The collector searches by name and returns its top hit, so a similarly named company ("Emaar Dubai Properties" for "Emaar Properties") must not be taken for this one.
      if (!info) return;
      const site = info.website ? hostOf(info.website) : null;
      const sameSite = !!domain && !!site && (site === domain || site.endsWith(`.${domain}`) || domain.endsWith(`.${site}`));
      if (!sameSite && !sameName(info.name, organisation)) return;
      linkedinUrl = info.linkedinUrl;
      const lines = [`Company: ${info.name}`, info.employees ? `Employees on LinkedIn: ${n(info.employees)}` : null, info.employeeRange ? `Employee range: ${info.employeeRange}` : null, info.industries.length ? `Industry: ${info.industries.join(", ")}` : null, info.headquarters ? `Headquarters: ${info.headquarters}` : null, info.website ? `Website: ${info.website}` : null, info.description ? `About: ${info.description}` : null].filter((l): l is string => !!l);
      const text = lines.join("\n");
      const row = await stored({ kind: "COMPANY_PROFILE", url: info.linkedinUrl, domain: "linkedin.com", title: `${info.name} on LinkedIn`, text });
      evidence.push({ id: row.id, url: info.linkedinUrl, title: `${info.name} on LinkedIn`, text, publishedAt: null });
      if (info.employees) {
        out.employees = info.employees;
        add({ kind: "FACT", statement: `About ${n(info.employees)} employees (LinkedIn page: ${info.name})`, sourceId: row.id, quote: `Employees on LinkedIn: ${n(info.employees)}`, detail: json({ group: "company", metric: "employees", value: info.employees }) });
      } else if (info.employeeRange) {
        add({ kind: "FACT", statement: `Employee range ${info.employeeRange}`, sourceId: row.id, quote: `Employee range: ${info.employeeRange}`, detail: json({ group: "company", metric: "range" }) });
      }
      if (info.industries.length) add({ kind: "FACT", statement: `Sector: ${info.industries.join(", ")}`, sourceId: row.id, quote: `Industry: ${info.industries.join(", ")}`, detail: json({ group: "company", metric: "sector" }) });
    });
  }

  // 2. Public web sources: revenue, funding, and headcount when the company page gave none.
  await step("finding company size and funding", undefined, async () => {
    const q = `"${org}" number of employees annual revenue funding`;
    const hits = await providers.search.search(q, { maxResults: 5, topic: "general" });
    for (const h of hits) {
      const text = `${h.title}\n${h.snippet}`;
      if (!mentionsSubject(text, h.url, subject)) continue;
      const row = await stored({ kind: "SEARCH_RESULT", url: h.url, domain: SOURCE_DOMAIN(h.url), title: h.title, publishedAt: parseDate(h.publishedDate), text, query: q });
      evidence.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
    }
    const { value } = await extractCompanyFacts(organisation, settings.exceptionSectors, evidence, providers.llm);
    if (value.employees && out.employees === null) {
      out.employees = value.employees.value;
      add({ kind: "FACT", statement: `About ${n(value.employees.value)} employees`, sourceId: value.employees.sourceId, quote: value.employees.quote, detail: json({ group: "company", metric: "employees", value: value.employees.value }) });
    }
    if (value.revenue) {
      out.revenueUsdM = value.revenue.usdMillions;
      add({ kind: "FACT", statement: `Yearly revenue of about USD ${n(value.revenue.usdMillions)} million`, sourceId: value.revenue.sourceId, quote: value.revenue.quote, detail: json({ group: "company", metric: "revenue", value: value.revenue.usdMillions }) });
    }
    for (const f of value.funding) add({ kind: "FACT", statement: f.statement, sourceId: f.sourceId, quote: f.quote, eventDate: f.date, detail: json({ group: "company", metric: "funding" }) });
    if (value.exceptionSector) {
      out.exceptionSector = value.exceptionSector.sector;
      add({ kind: "FACT", statement: `Appears to be a ${value.exceptionSector.sector}`, sourceId: value.exceptionSector.sourceId, quote: value.exceptionSector.quote, detail: json({ group: "company", metric: "exception_sector" }) });
    }
  });
  if (out.employees === null) add({ kind: "UNAVAILABLE", statement: "The number of employees could not be found.", detail: json({ group: "company", metric: "employees" }) });
  if (out.revenueUsdM === null) add({ kind: "UNAVAILABLE", statement: "Yearly revenue could not be found in public sources.", detail: json({ group: "company", metric: "revenue" }) });

  // 3. Hiring: open AI-related roles are a sign of real intent.
  if (!providers.jobs) {
    add({ kind: "UNAVAILABLE", statement: "Job postings are not switched on for this workspace, so hiring signals were not checked.", detail: json({ group: "hiring" }) });
  } else {
    let checked = false;
    await step("checking AI-related job postings", undefined, async () => {
      const jobs = await providers.jobs!.search({ companyName: org, companyUrl: linkedinUrl, maxItems: 25 });
      checked = true;
      const ai = jobs.filter((j) => (!j.company || mentionsSubject(j.company, "", subject)) && AI_ROLE.test(j.title));
      if (ai.length === 0) {
        add({ kind: "UNAVAILABLE", statement: "No AI-related job postings were returned for this organisation in the last month.", detail: json({ group: "hiring", count: 0 }) });
        return;
      }
      const lines = ai.map((j) => `${j.title}${j.location ? ` - ${j.location}` : ""}${j.postedAt ? ` - posted ${j.postedAt.slice(0, 10)}` : ""}`);
      const text = lines.join("\n");
      const row = await stored({ kind: "JOB_LISTING", url: linkedinUrl, domain: "linkedin.com", title: `AI-related job postings at ${organisation}`, text });
      add({ kind: "FACT", statement: `${ai.length} AI-related job posting${ai.length === 1 ? "" : "s"} in the last month: ${ai.slice(0, 3).map((j) => j.title).join("; ")}${ai.length > 3 ? "; and more" : ""}`, sourceId: row.id, quote: lines[0], detail: json({ group: "hiring", count: ai.length, titles: ai.map((j) => j.title).slice(0, 10) }) });
    });
    if (!checked) add({ kind: "UNAVAILABLE", statement: "Job postings could not be checked right now.", detail: json({ group: "hiring" }) });
  }

  // 4. Competitor movement: peers are inferred from public sources, then checked for agentic-AI announcements.
  const peerHits: EvidenceSource[] = [];
  await step("identifying competitors", undefined, async () => {
    const q = `"${org}" competitors rivals market`;
    const hits = await providers.search.search(q, { maxResults: 5, topic: "general" });
    for (const h of hits) {
      const text = `${h.title}\n${h.snippet}`;
      if (!mentionsSubject(text, h.url, subject)) continue;
      const row = await stored({ kind: "SEARCH_RESULT", url: h.url, domain: SOURCE_DOMAIN(h.url), title: h.title, publishedAt: parseDate(h.publishedDate), text, query: q });
      peerHits.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
    }
    out.competitors = await inferCompetitors(organisation, peerHits, providers.llm);
  });

  if (out.competitors.length === 0) {
    add({ kind: "UNAVAILABLE", statement: "No competitors could be identified from public sources, so competitor movement was not checked.", detail: json({ group: "competitor" }) });
  } else {
    let found = 0;
    await step("checking competitor announcements", undefined, async () => {
      const names = out.competitors.map((c) => searchTerm(c));
      const q = `(${names.map((c) => `"${c}"`).join(" OR ")}) agentic AI OR "AI agents" launch announcement`;
      const hits = await providers.search.search(q, { maxResults: 6, topic: "news", timeRange: "year" });
      const sources: EvidenceSource[] = [];
      for (const h of hits) {
        const text = `${h.title}\n${h.snippet}`;
        if (!mentionsSubject(text, h.url, { names: out.competitors, domains: [] }) || !AI_TEXT.test(text)) continue;
        const row = await stored({ kind: "SEARCH_RESULT", url: h.url, domain: SOURCE_DOMAIN(h.url), title: h.title, publishedAt: parseDate(h.publishedDate), text, query: q });
        sources.push({ id: row.id, url: h.url, title: h.title, text, publishedAt: parseDate(h.publishedDate) });
      }
      const { value } = await extractAnnouncements(`${out.competitors.join(", ")} (competitors of ${organisation}); only agentic AI or AI agent moves`, sources, providers.llm);
      for (const a of value) {
        if (!AI_TEXT.test(`${a.statement} ${a.quote}`)) continue;
        found++;
        add({ kind: "FACT", statement: a.statement, sourceId: a.sourceId, quote: a.quote, eventDate: a.date, detail: json({ group: "competitor", competitors: out.competitors }) });
      }
    });
    if (found === 0) add({ kind: "UNAVAILABLE", statement: `No agentic-AI announcements by ${out.competitors.join(", ")} were found in the last year.`, detail: json({ group: "competitor", competitors: out.competitors }) });
  }

  return out;
}
