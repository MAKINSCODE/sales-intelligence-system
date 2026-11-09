import type { ProfileFacts } from "./evidence";
import type { ProfileForm } from "@/lib/team/profile";

export type Connection = {
  kind: "education" | "employer" | "place";
  title: string;
  detail: string;
  overlap: "overlapping" | "not_overlapping" | "unknown";
  // The lead-side fact this rests on, so it can be traced to a source and quote.
  leadSourceId: string;
  leadQuote: string;
};

const NOISE = new Set(["the", "of", "and", "for", "at", "in", "university", "college", "school", "institute", "institution", "polytechnic", "ltd", "limited", "llc", "inc", "plc", "gmbh", "corp", "co", "company", "group", "technologies", "technology", "consulting", "services"]);

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const tokens = (s: string) =>
  new Set(
    fold(s)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !NOISE.has(w)),
  );

// Names match when their distinctive words are identical, so "Westfield University" matches
// "University of Westfield" but "Northfield University" does not match "Westfield University".
export function sameName(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0 || ta.size !== tb.size) return false;
  return [...ta].every((w) => tb.has(w));
}

const monthIndex = (v: string | null, isEnd: boolean): number | null => {
  if (!v) return null;
  if (v.toLowerCase() === "present") return new Date().getUTCFullYear() * 12 + new Date().getUTCMonth();
  const m = v.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) - 1 : isEnd ? 11 : 0;
  return Number(m[1]) * 12 + month;
};

export function periodOverlap(a: { start: string | null; end: string | null }, b: { start: string | null; end: string | null }): Connection["overlap"] {
  const [as, ae, bs, be] = [monthIndex(a.start, false), monthIndex(a.end, true), monthIndex(b.start, false), monthIndex(b.end, true)];
  if (as === null || ae === null || bs === null || be === null) return "unknown";
  return as <= be && bs <= ae ? "overlapping" : "not_overlapping";
}

const overlapText = (o: Connection["overlap"]) =>
  o === "overlapping" ? "The dates overlap, so they may have been there at the same time." : o === "not_overlapping" ? "The dates do not overlap." : "One or both date ranges are missing, so overlap cannot be checked.";

const span = (s: string | null, e: string | null) => (s || e ? `${s ?? "?"} to ${e ?? "?"}` : "dates not stated");

function placeParts(p: string) {
  return fold(p)
    .split(/[,/|-]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

function samePlace(a: string, b: string) {
  const pa = placeParts(a);
  const pb = placeParts(b);
  return pa.some((x) => pb.some((y) => x === y));
}

// Only physical places count: stated home base, on-site/hybrid work and study. A remote role's region does not.
export function referencePlaces(ref: ProfileForm) {
  const out: { place: string; basis: string }[] = [];
  if (ref.homeBase) out.push({ place: ref.homeBase, basis: "is based in" });
  for (const e of ref.employment) if (e.location && e.workMode !== "remote") out.push({ place: e.location, basis: `worked at ${e.organisation}` });
  for (const e of ref.education) if (e.location) out.push({ place: e.location, basis: `studied at ${e.institution}` });
  return out;
}

export function findConnections(ref: ProfileForm, lead: ProfileFacts): Connection[] {
  const out: Connection[] = [];
  const who = ref.fullName || "Team member";

  for (const le of lead.education) {
    for (const re of ref.education) {
      if (!sameName(le.institution, re.institution)) continue;
      const overlap = periodOverlap(le, re);
      out.push({
        kind: "education",
        title: `${who} also studied at ${re.institution}`,
        detail: `They: ${span(le.start, le.end)}. ${who}: ${span(re.start, re.end)}. ${overlapText(overlap)}`,
        overlap,
        leadSourceId: le.sourceId,
        leadQuote: le.quote,
      });
    }
  }

  const leadJobs = [...lead.employment, ...(lead.currentRole?.organisation ? [{ organisation: lead.currentRole.organisation, title: lead.currentRole.title, start: null, end: "present", quote: lead.currentRole.quote, sourceId: lead.currentRole.sourceId }] : [])];
  for (const lj of leadJobs) {
    for (const rj of ref.employment) {
      if (!sameName(lj.organisation, rj.organisation)) continue;
      const overlap = periodOverlap(lj, rj);
      out.push({
        kind: "employer",
        title: `${who} also worked at ${rj.organisation}`,
        detail: `They: ${span(lj.start, lj.end)}. ${who}: ${span(rj.start, rj.end)}. ${overlapText(overlap)}`,
        overlap,
        leadSourceId: lj.sourceId,
        leadQuote: lj.quote,
      });
    }
  }

  if (lead.location) {
    for (const rp of referencePlaces(ref)) {
      if (!samePlace(lead.location.place, rp.place)) continue;
      out.push({
        kind: "place",
        title: `${who} is also connected to ${rp.place}`,
        detail: `They are reported in ${lead.location.place}. ${who} ${rp.basis} ${rp.place}.`,
        overlap: "unknown",
        leadSourceId: lead.location.sourceId,
        leadQuote: lead.location.quote,
      });
      break;
    }
  }

  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.title) ? false : (seen.add(c.title), true)));
}
