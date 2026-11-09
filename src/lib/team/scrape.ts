import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isSafeToRepeat, retry } from "@/lib/retry";
import { cleanText } from "@/lib/research/policy";
import { ProviderNotConfigured } from "@/lib/research/providers";
import { profileFormSchema, type ProfileForm } from "./profile";

const ACTOR = "harvestapi~linkedin-profile-scraper";
const MODE = "Profile details no email ($4 per 1k)";
const REQUEST_TIMEOUT_S = 90;
const MAX_CHARGE_USD = 0.05;

export class ProfileFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface ProfileProvider {
  fetchProfile(linkedinUrl: string): Promise<ProfileForm>;
}

const str = z.string().nullable().optional();
const when = z.looseObject({ month: str, year: z.number().nullable().optional(), text: str }).nullable().optional();

const item = z.looseObject({
  publicIdentifier: str,
  firstName: str,
  lastName: str,
  headline: str,
  about: str,
  location: z.looseObject({ linkedinText: str, parsed: z.looseObject({ text: str }).nullable().optional() }).nullable().optional(),
  experience: z
    .array(z.looseObject({ position: str, location: str, workplaceType: str, companyName: str, startDate: when, endDate: when }))
    .nullable()
    .optional(),
  education: z
    .array(z.looseObject({ schoolName: str, degree: str, fieldOfStudy: str, startDate: when, endDate: when }))
    .nullable()
    .optional(),
  skills: z.array(z.looseObject({ name: str })).nullable().optional(),
});

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function period(d: z.infer<typeof when>, isEnd: boolean): string | null {
  if (!d) return null;
  if (isEnd && d.text && /present/i.test(d.text)) return "present";
  if (!d.year) return null;
  const m = d.month ? MONTHS.indexOf(d.month.slice(0, 3).toLowerCase()) : -1;
  return m >= 0 ? `${d.year}-${String(m + 1).padStart(2, "0")}` : String(d.year);
}

const WORK_MODE: Record<string, ProfileForm["employment"][number]["workMode"]> = { "on-site": "onsite", onsite: "onsite", hybrid: "hybrid", remote: "remote" };

// LinkedIn titles often carry a "| keyword | keyword" tail that is marketing, not the role.
const roleOf = (p: string | null | undefined) => p?.split("|")[0].trim() || null;

const clean = (s: string | null | undefined) => (s ? cleanText(s).trim() : null);

// Anything that does not fit is dropped; a profile with no career or education detail is rejected so it cannot overwrite good data.
export function parseProfile(items: unknown): ProfileForm {
  const first = Array.isArray(items) ? items.map((i) => item.safeParse(i)).find((r) => r.success) : undefined;
  if (!first?.success) throw new ProfileFetchError("No profile data was returned for that address.");
  const p = first.data;

  const employment = (p.experience ?? []).flatMap((e) => {
    const organisation = clean(e.companyName);
    if (!organisation) return [];
    return [{ organisation, title: clean(roleOf(e.position)), start: period(e.startDate, false), end: period(e.endDate, true), location: clean(e.location), workMode: WORK_MODE[(e.workplaceType ?? "").toLowerCase()] ?? "unknown", regionServed: null }];
  });
  const education = (p.education ?? []).flatMap((e) => {
    const institution = clean(e.schoolName);
    if (!institution) return [];
    const qualification = [clean(e.degree), clean(e.fieldOfStudy)].filter(Boolean).join(", ") || null;
    return [{ institution, qualification, start: period(e.startDate, false), end: period(e.endDate, true), location: null }];
  });
  if (employment.length === 0 && education.length === 0) throw new ProfileFetchError("The profile has no visible career or education details.");

  const fullName = [clean(p.firstName), clean(p.lastName)].filter(Boolean).join(" ") || p.publicIdentifier || "";
  const expertise = [...new Set((p.skills ?? []).map((s) => clean(s.name)).filter((s): s is string => !!s))];
  const parsed = profileFormSchema.safeParse({
    fullName,
    headline: clean(p.headline)?.slice(0, 300),
    summary: clean(p.about)?.slice(0, 2000),
    homeBase: clean(p.location?.parsed?.text ?? p.location?.linkedinText),
    education: education.slice(0, 20),
    employment: employment.slice(0, 40),
    expertise: expertise.map((s) => s.slice(0, 100)).slice(0, 60),
  });
  if (!parsed.success) throw new ProfileFetchError("The profile could not be understood.");
  return parsed.data;
}

export function apifyProfileProvider(token = env().APIFY_TOKEN, fetchImpl: typeof fetch = fetch): ProfileProvider {
  if (!token) throw new ProviderNotConfigured("APIFY_TOKEN is not set");

  return {
    async fetchProfile(linkedinUrl) {
      const params = new URLSearchParams({ timeout: String(REQUEST_TIMEOUT_S), maxItems: "1", maxTotalChargeUsd: String(MAX_CHARGE_USD) });
      const body = JSON.stringify({ profileScraperMode: MODE, queries: [linkedinUrl] });
      // A run is billed, so only a failure where the request cannot have started the actor is repeated.
      const items = await retry(
        async () => {
          const res = await fetchImpl(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${params}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body,
            signal: AbortSignal.timeout((REQUEST_TIMEOUT_S + 15) * 1000),
          });
          // The body is not echoed: it can contain request details we never want in logs or the UI.
          if (!res.ok) throw new ProfileFetchError(`Profile collection failed (HTTP ${res.status})`, res.status);
          return res.json();
        },
        { retries: 1, baseMs: 1500, maxMs: 4000, shouldRetry: isSafeToRepeat, onRetry: ({ attempt, delayMs, err }) => log.warn("provider.retry", { provider: "profiles", attempt, delayMs, err }) },
      );
      return parseProfile(items);
    },
  };
}
