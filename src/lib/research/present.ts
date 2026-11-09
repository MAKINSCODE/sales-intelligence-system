import type { ClaimView, RunView } from "./view";

export type NumberedSource = { n: number; id: string; title: string; url: string | null; domain: string | null; publishedAt: string | null; retrievedAt: string; collected: boolean };

// Sources are numbered in order of first use, so footnote [1] is always the first thing a reader meets.
export function numberSources(claims: ClaimView[]): { sources: NumberedSource[]; numberOf: (claim: ClaimView) => number | null } {
  const order: NumberedSource[] = [];
  const byId = new Map<string, NumberedSource>();
  for (const c of claims) {
    const s = c.source;
    if (!s || byId.has(s.id)) continue;
    const entry: NumberedSource = { n: order.length + 1, id: s.id, title: s.title || s.domain || "Source", url: s.url, domain: s.domain, publishedAt: s.publishedAt, retrievedAt: s.retrievedAt, collected: s.kind === "SOCIAL_POST" || s.kind === "COMPANY_PROFILE" || s.kind === "JOB_LISTING" };
    byId.set(s.id, entry);
    order.push(entry);
  }
  return { sources: order, numberOf: (c) => (c.source ? (byId.get(c.source.id)?.n ?? null) : null) };
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// The current role is also listed in the career; show it once.
export function careerWithoutDuplicates(current: ClaimView | undefined, career: ClaimView[]): ClaimView[] {
  if (!current) return career;
  const key = norm(current.statement);
  return career.filter((c) => !norm(c.statement).startsWith(key));
}

const detail = (c: ClaimView) => (c.detail ?? {}) as Record<string, unknown>;

export type Snapshot = {
  name: string;
  role: string | null;
  place: string | null;
  headline: { verified: number; connections: number; news: number; posts: number };
  latestNews: ClaimView | null;
  latestPost: ClaimView | null;
  angle: ClaimView | null;
};

export function buildSnapshot(run: RunView): Snapshot {
  const by = (section: ClaimView["section"]) => run.claims.filter((c) => c.section === section);
  const who = by("WHO");
  const current = who.find((c) => detail(c).group === "current");
  const place = who.find((c) => detail(c).group === "location");
  const news = by("NOW").filter((c) => c.kind === "FACT");
  const posts = by("ACTIVITY").filter((c) => c.kind === "COLLECTED");
  const connections = by("CONNECTIONS").filter((c) => c.kind === "POTENTIAL");
  const newest = (a: ClaimView[]) => [...a].sort((x, y) => (y.eventDate ?? "").localeCompare(x.eventDate ?? ""))[0] ?? null;
  const memberCount = new Set(connections.filter((c) => detail(c).commonGround !== true).map((c) => detail(c).member ?? c.id)).size;
  const points = by("CONVERSATION").filter((c) => c.kind === "HYPOTHESIS");

  const fallbackRole = run.lead.jobTitle && run.lead.company ? `${run.lead.jobTitle} at ${run.lead.company}` : (run.lead.jobTitle ?? run.lead.company ?? null);
  return {
    name: run.lead.name,
    role: current?.statement ?? fallbackRole,
    place: place?.statement.replace(/^Based in /, "") ?? run.lead.country,
    headline: { verified: who.filter((c) => c.kind === "FACT").length, connections: memberCount, news: news.length, posts: posts.length },
    latestNews: newest(news),
    latestPost: newest(posts),
    angle: points.find((c) => detail(c).role === "angle") ?? points[0] ?? null,
  };
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");

export const formatDay = (iso: string | null | undefined) => {
  if (!iso) return null;
  if (/^\d{4}$/.test(iso)) return iso;
  const d = new Date(/^\d{4}-\d{2}(-\d{2})?$/.test(iso) ? `${iso}${iso.length === 7 ? "-01" : ""}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const withDay = /^\d{4}-\d{2}-\d{2}/.test(iso);
  return d.toLocaleDateString("en-GB", { day: withDay ? "numeric" : undefined, month: "short", year: "numeric", timeZone: "UTC" });
};
