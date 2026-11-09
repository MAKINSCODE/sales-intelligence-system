import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isSafeToRepeat, retry } from "@/lib/retry";
import { cleanText } from "./policy";
import { ProviderNotConfigured } from "./providers";
import type { CompanyInfo, CompanyProvider, JobPosting, JobsProvider, JobsRequest } from "./types";

const COMPANY_ACTOR = "harvestapi~linkedin-company";
const JOBS_ACTOR = "harvestapi~linkedin-job-search";
const REQUEST_TIMEOUT_S = 90;

export class CollectorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const str = z.string().nullable().optional();

const company = z.looseObject({
  name: str,
  linkedinUrl: str,
  industries: z.array(z.union([z.string(), z.looseObject({ name: str, title: str })])).nullable().optional(),
  employeeCount: z.number().nullable().optional(),
  employeeCountRange: z.looseObject({ start: z.number().nullable().optional(), end: z.number().nullable().optional() }).nullable().optional(),
  website: str,
  description: str,
  tagline: str,
  locations: z.array(z.looseObject({ headquarter: z.boolean().nullable().optional(), parsed: z.looseObject({ text: str }).nullable().optional() })).nullable().optional(),
});

const job = z.looseObject({
  title: str,
  linkedinUrl: str,
  postedDate: str,
  location: z.looseObject({ linkedinText: str }).nullable().optional(),
  company: z.looseObject({ name: str }).nullable().optional(),
});

const clean = (s: string | null | undefined) => (s ? cleanText(s).trim() || null : null);

const linkedinUrl = (u: string | null | undefined) => {
  try {
    const url = new URL(u ?? "");
    return url.protocol === "https:" && /(^|\.)linkedin\.com$/.test(url.hostname) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
};

const rangeText = (r: { start?: number | null; end?: number | null } | null | undefined) =>
  r?.start ? (r.end ? `${r.start}-${r.end}` : `${r.start}+`) : null;

export function parseCompany(items: unknown): CompanyInfo | null {
  if (!Array.isArray(items)) return null;
  for (const raw of items) {
    const p = company.safeParse(raw);
    if (!p.success || !clean(p.data.name)) continue;
    const d = p.data;
    const hq = d.locations?.find((l) => l.headquarter) ?? d.locations?.[0];
    return {
      name: clean(d.name)!,
      linkedinUrl: linkedinUrl(d.linkedinUrl),
      industries: (d.industries ?? []).map((i) => (typeof i === "string" ? i : (i.title ?? i.name ?? ""))).map((i) => cleanText(i).trim()).filter(Boolean).slice(0, 5),
      employees: typeof d.employeeCount === "number" && d.employeeCount > 0 ? Math.round(d.employeeCount) : null,
      employeeRange: rangeText(d.employeeCountRange),
      website: clean(d.website),
      description: clean(d.tagline ?? d.description)?.slice(0, 400) ?? null,
      headquarters: clean(hq?.parsed?.text),
    };
  }
  return null;
}

export function parseJobs(items: unknown): JobPosting[] {
  if (!Array.isArray(items)) return [];
  const out: JobPosting[] = [];
  for (const raw of items) {
    const p = job.safeParse(raw);
    const title = p.success ? clean(p.data.title) : null;
    if (!p.success || !title) continue;
    out.push({ title: title.slice(0, 160), url: linkedinUrl(p.data.linkedinUrl), postedAt: p.data.postedDate ?? null, location: clean(p.data.location?.linkedinText), company: clean(p.data.company?.name) });
  }
  return out;
}

async function runActor(actor: string, body: unknown, token: string, maxItems: number, maxChargeUsd: number, fetchImpl: typeof fetch): Promise<unknown> {
  const params = new URLSearchParams({ timeout: String(REQUEST_TIMEOUT_S), maxItems: String(maxItems), maxTotalChargeUsd: String(maxChargeUsd) });
  // A run is billed, so only a failure where the request cannot have started the actor is repeated.
  return retry(
    async () => {
      const res = await fetchImpl(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout((REQUEST_TIMEOUT_S + 15) * 1000),
      });
      // The body is not echoed: it can contain request details we never want in logs or the UI.
      if (!res.ok) throw new CollectorError(`Collection failed (HTTP ${res.status})`, res.status);
      return res.json();
    },
    { retries: 1, baseMs: 1500, maxMs: 4000, shouldRetry: isSafeToRepeat, onRetry: ({ attempt, delayMs, err }) => log.warn("provider.retry", { provider: "company", attempt, delayMs, err }) },
  );
}

export function apifyCompanyProvider(token = env().APIFY_TOKEN, fetchImpl: typeof fetch = fetch): CompanyProvider {
  if (!token) throw new ProviderNotConfigured("APIFY_TOKEN is not set");
  return {
    async lookup({ name, linkedinUrl: url }) {
      const body = url ? { companies: [url] } : { searches: [name] };
      return parseCompany(await runActor(COMPANY_ACTOR, body, token, 1, 0.05, fetchImpl));
    },
  };
}

// Words that mark a role as AI-related; the actor's own search is broad, so titles are checked again here.
export const AI_ROLE = /\b(ai|a\.i\.|artificial intelligence|machine learning|ml|llm|generative|gen ?ai|agentic|nlp|data scientist|prompt engineer|computer vision|mlops)\b/i;

const AI_QUERY = 'AI OR "artificial intelligence" OR "machine learning" OR LLM OR agentic OR "data scientist" OR "generative AI"';

export function apifyJobsProvider(token = env().APIFY_TOKEN, fetchImpl: typeof fetch = fetch): JobsProvider {
  if (!token) throw new ProviderNotConfigured("APIFY_TOKEN is not set");
  return {
    async search({ companyName, companyUrl, maxItems }: JobsRequest) {
      const body = { jobTitles: [AI_QUERY], company: [companyUrl ?? companyName], maxItems, postedLimit: "month", sortBy: "date" };
      return parseJobs(await runActor(JOBS_ACTOR, body, token, maxItems, 0.1, fetchImpl));
    },
  };
}
