import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isSafeToRepeat, retry } from "@/lib/retry";
import { cleanText } from "./policy";
import { ProviderNotConfigured } from "./providers";
import type { PostProvider, PostRequest, RawPost } from "./types";

const ACTOR = "harvestapi~linkedin-post-search";
const REQUEST_TIMEOUT_S = 90;

export class PostProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const num = z.number().nullable().optional();

// Tolerant of extra and missing fields: anything that does not fit is dropped rather than trusted.
const item = z.looseObject({
  type: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  linkedinUrl: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  author: z.looseObject({ publicIdentifier: z.string().nullable().optional(), name: z.string().nullable().optional() }).nullable().optional(),
  postedAt: z.looseObject({ date: z.string().nullable().optional() }).nullable().optional(),
  engagement: z.looseObject({ likes: num, comments: num, shares: num }).nullable().optional(),
  repostedBy: z.unknown().optional(),
  resharedPost: z.unknown().optional(),
});

export function parsePosts(items: unknown): RawPost[] {
  if (!Array.isArray(items)) return [];
  const out: RawPost[] = [];
  for (const raw of items) {
    const parsed = item.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data;
    if (p.type && p.type !== "post" && p.type !== "repost") continue;
    const text = p.content ? cleanText(p.content).trim() : "";
    if (!text || p.id === undefined) continue;
    out.push({
      id: String(p.id),
      url: safeUrl(p.linkedinUrl),
      text,
      postedAt: p.postedAt?.date ?? null,
      authorId: p.author?.publicIdentifier ?? null,
      authorName: p.author?.name ?? null,
      likes: p.engagement?.likes ?? null,
      comments: p.engagement?.comments ?? null,
      shares: p.engagement?.shares ?? null,
      isRepost: p.type === "repost" || !!p.repostedBy || !!p.resharedPost,
    });
  }
  return out;
}

function safeUrl(u: string | null | undefined) {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)linkedin\.com$/.test(url.hostname) ? `${url.origin}${url.pathname}` : null;
  } catch {
    return null;
  }
}

export function apifyPostProvider(token = env().APIFY_TOKEN, fetchImpl: typeof fetch = fetch): PostProvider {
  if (!token) throw new ProviderNotConfigured("APIFY_TOKEN is not set");

  return {
    async fetchPosts({ profileUrl, maxPosts, maxChargeUsd }: PostRequest): Promise<RawPost[]> {
      const params = new URLSearchParams({ timeout: String(REQUEST_TIMEOUT_S), maxItems: String(maxPosts), maxTotalChargeUsd: String(maxChargeUsd) });
      const body = JSON.stringify({
        searchQueries: [env().APIFY_POST_QUERY],
        authorUrls: [profileUrl],
        maxPosts,
        sortBy: "date",
        postedLimit: "year",
        scrapeReactions: false,
        scrapeComments: false,
      });
      // A run is billed, so only a failure where the request cannot have started the actor is repeated.
      return retry(
        async () => {
          const res = await fetchImpl(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${params}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body,
            signal: AbortSignal.timeout((REQUEST_TIMEOUT_S + 15) * 1000),
          });
          if (!res.ok) {
            // The body is not echoed: it can contain request details we never want in logs or the UI.
            throw new PostProviderError(`Post collection failed (HTTP ${res.status})`, res.status);
          }
          return parsePosts(await res.json());
        },
        { retries: 1, baseMs: 1500, maxMs: 4000, shouldRetry: isSafeToRepeat, onRetry: ({ attempt, delayMs, err }) => log.warn("provider.retry", { provider: "posts", attempt, delayMs, err }) },
      );
    },
  };
}
