import { z } from "zod";

const DATE = /^(?:\d{4}(?:-\d{2})?|present)$/i;

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v);
const field = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable().default(null));
const dateField = z.preprocess(blankToNull, z.string().regex(DATE, "Use YYYY, YYYY-MM or present").nullable().default(null));

const employmentForm = z.object({
  organisation: z.string().trim().min(1, "Organisation is required").max(200),
  title: field(200),
  start: dateField,
  end: dateField,
  location: field(200),
  workMode: z.enum(["onsite", "hybrid", "remote", "unknown"]).default("unknown"),
  regionServed: field(200),
});

const educationForm = z.object({
  institution: z.string().trim().min(1, "Institution is required").max(200),
  qualification: field(200),
  start: dateField,
  end: dateField,
  location: field(200),
});

// A remote role has no physical location; keep only the region it served.
const normaliseEmployment = <T extends { workMode: string; location: string | null; regionServed: string | null }>(e: T): T =>
  e.workMode === "remote" ? { ...e, regionServed: e.regionServed ?? e.location, location: null } : e;

export const profileFormSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required").max(200),
  headline: field(300),
  summary: field(2000),
  homeBase: field(200),
  education: z.array(educationForm).max(20),
  employment: z.array(employmentForm.transform(normaliseEmployment)).max(40),
  expertise: z.array(z.string().trim().min(1).max(100)).max(60),
});

export type ProfileForm = z.infer<typeof profileFormSchema>;

export type StoredLocation = { place: string; basis: "stated_home_base" };

export function emptyProfile(fullName = ""): ProfileForm {
  return { fullName, headline: null, summary: null, homeBase: null, education: [], employment: [], expertise: [] };
}

export function toStored(p: ProfileForm) {
  const locations: StoredLocation[] = p.homeBase ? [{ place: p.homeBase, basis: "stated_home_base" }] : [];
  return { education: p.education, employment: p.employment, locations };
}

export function fromRow(row: {
  fullName: string | null;
  linkedinUrl?: string;
  headline: string | null;
  summary: string | null;
  education: unknown;
  employment: unknown;
  locations: unknown;
  expertise: string[];
}): ProfileForm {
  const loc = Array.isArray(row.locations) ? (row.locations as StoredLocation[]) : [];
  return {
    fullName: row.fullName ?? "",
    headline: row.headline,
    summary: row.summary,
    homeBase: loc[0]?.place ?? null,
    education: Array.isArray(row.education) ? (row.education as ProfileForm["education"]) : [],
    employment: Array.isArray(row.employment) ? (row.employment as ProfileForm["employment"]) : [],
    expertise: row.expertise,
  };
}
