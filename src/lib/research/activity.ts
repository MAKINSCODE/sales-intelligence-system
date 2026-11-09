import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { BudgetExceeded } from "./budget";
import { canonicalProfileUrl, keepOwnPosts, linkedinProfileId, parseDate } from "./policy";
import { excerpt, labelTopics } from "./posts";
import type { Providers, RawPost } from "./types";

export const POSTS_NOT_ENABLED = "Recent LinkedIn posts are not switched on for this workspace.";
export const POSTS_NO_PROFILE = "No confirmed LinkedIn profile link was available, so no posts were collected. Add the person's profile link to this lead and refresh the research.";
export const POSTS_UNCONFIRMED = "Posts are only collected for a person you have confirmed, so none were collected.";
export const POSTS_NONE = "No public posts from this profile were returned for the last year.";
export const POSTS_NOT_MATCHED = "Posts were returned, but none could be confirmed as written by this profile, so none are shown.";

export type Coverage = { profile: string | null; returned: number; kept: number; rejected: number; collectedBy: "third-party collector" };

export type ActivityResult = { claims: Prisma.ClaimCreateManyInput[]; coverage: Coverage | null; partial: string | null; profile: string | null };

const unavailable = (runId: string, statement: string): Prisma.ClaimCreateManyInput => ({ runId, section: "ACTIVITY", kind: "UNAVAILABLE", statement, position: 0 });
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
// Quotes must be a verbatim slice of the stored post text, so no ellipsis and no mid-word cut.
const quoteOf = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 200 ? t : t.slice(0, 200).replace(/\s+\S*$/, "");
};

export async function profileFor(runId: string, leadProfileUrl: string | null, candidateSourceIds: string[]): Promise<string | null> {
  const fromLead = linkedinProfileId(leadProfileUrl);
  if (fromLead) return fromLead;
  if (candidateSourceIds.length === 0) return null;
  const rows = await db.source.findMany({ where: { runId, id: { in: candidateSourceIds } }, select: { url: true } });
  const ids = new Set(rows.map((r) => linkedinProfileId(r.url)).filter((x): x is string => !!x));
  // More than one distinct profile means the match is ambiguous, so none is used.
  return ids.size === 1 ? [...ids][0] : null;
}

export async function collectActivity(args: { runId: string; leadProfileUrl: string | null; candidateSourceIds: string[]; confirmed: boolean; providers: Providers }): Promise<ActivityResult> {
  const { runId, providers } = args;
  if (!providers.posts) return { claims: [unavailable(runId, POSTS_NOT_ENABLED)], coverage: null, partial: null, profile: null };
  if (!args.confirmed) return { claims: [unavailable(runId, POSTS_UNCONFIRMED)], coverage: null, partial: null, profile: null };

  const profile = await profileFor(runId, args.leadProfileUrl, args.candidateSourceIds);
  if (!profile) return { claims: [unavailable(runId, POSTS_NO_PROFILE)], coverage: null, partial: null, profile: null };

  let raw: RawPost[];
  try {
    raw = await providers.posts.fetchPosts({ profileUrl: canonicalProfileUrl(profile), maxPosts: env().RESEARCH_MAX_POSTS, maxChargeUsd: env().APIFY_MAX_CHARGE_USD });
  } catch (e) {
    const stopped = e instanceof BudgetExceeded;
    if (!stopped) log.error("run.posts.failed", { err: e });
    return {
      claims: [unavailable(runId, "Recent posts could not be collected right now, so none are shown.")],
      coverage: null,
      partial: stopped ? "Stopped early (post limit) while collecting recent posts." : "Could not finish collecting recent posts.",
      profile,
    };
  }

  const { kept, rejected } = keepOwnPosts(raw, profile);
  const seen = new Set<string>();
  const posts = kept
    .filter((p) => !seen.has(p.id) && !!seen.add(p.id))
    .sort((a, b) => (parseDate(b.postedAt)?.getTime() ?? 0) - (parseDate(a.postedAt)?.getTime() ?? 0))
    .slice(0, env().RESEARCH_MAX_POSTS);
  const coverage: Coverage = { profile, returned: raw.length, kept: posts.length, rejected, collectedBy: "third-party collector" };
  log.info("run.posts.collected", { returned: raw.length, kept: posts.length, rejected });
  if (posts.length === 0) return { claims: [unavailable(runId, raw.length > 0 ? POSTS_NOT_MATCHED : POSTS_NONE)], coverage, partial: null, profile };

  let topics = new Map<string, string>();
  try {
    topics = await labelTopics(posts.map((p) => ({ id: p.id, text: p.text, postedAt: p.postedAt })), providers.llm);
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) log.error("run.posts.topics_failed", { err: e });
  }

  const claims: Prisma.ClaimCreateManyInput[] = [];
  for (const [i, p] of posts.entries()) {
    const posted = parseDate(p.postedAt);
    const source = await db.source.create({
      data: { runId, kind: "SOCIAL_POST", url: p.url, domain: "linkedin.com", title: `Post by ${p.authorName ?? profile}`, publishedAt: posted, text: p.text },
      select: { id: true },
    });
    claims.push({
      runId,
      section: "ACTIVITY",
      kind: "COLLECTED",
      statement: excerpt(p.text),
      sourceId: source.id,
      quote: quoteOf(p.text),
      eventDate: day(posted),
      detail: { topic: topics.get(p.id) ?? null, likes: p.likes, comments: p.comments, shares: p.shares },
      position: i,
    });
  }
  return { claims, coverage, partial: null, profile };
}
