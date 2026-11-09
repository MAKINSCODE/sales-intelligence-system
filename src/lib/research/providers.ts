import "server-only";
import { tavily } from "@tavily/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { retry } from "@/lib/retry";
import { cleanText, isFetchable } from "./policy";
import { apifyPostProvider } from "./apify";
import { apifyCompanyProvider, apifyJobsProvider } from "./apify-company";
import { apifyPhotoProvider } from "./apify-photo";
import { apifyProfileProvider } from "@/lib/team/scrape";
import type { LlmProvider, PageText, Providers, SearchHit, SearchOptions, SearchProvider } from "./types";

const MAX_PAGE_CHARS = 12_000;
const CALL_TIMEOUT_MS = 30_000;

export class ProviderNotConfigured extends Error {}

// Slow or flaky links to a provider are retried a couple of times before a step is given up on.
const withRetry = <T>(provider: string, fn: () => Promise<T>) =>
  retry(fn, { retries: 2, baseMs: 600, maxMs: 4000, onRetry: ({ attempt, delayMs, err }) => log.warn("provider.retry", { provider, attempt, delayMs, err }) });

const httpUrl = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

export function tavilyProvider(apiKey = env().TAVILY_API_KEY): SearchProvider {
  if (!apiKey) throw new ProviderNotConfigured("TAVILY_API_KEY is not set");
  const client = tavily({ apiKey });

  return {
    async search(query: string, options: SearchOptions): Promise<SearchHit[]> {
      const res = await withRetry("search", () =>
        client.search(query, {
          maxResults: options.maxResults,
          searchDepth: "basic",
          topic: options.topic ?? "general",
          timeRange: options.timeRange,
          includeAnswer: false,
          timeout: CALL_TIMEOUT_MS / 1000,
        }),
      );
      // A result without a usable address cannot be cited, so it is dropped here rather than failing the run later.
      return (res.results ?? []).filter((r) => httpUrl(r.url)).map((r) => ({
        id: r.id ?? r.url,
        url: r.url,
        title: cleanText(r.title ?? ""),
        snippet: cleanText(r.content ?? ""),
        score: r.score,
        publishedDate: r.publishedDate || null,
      }));
    },

    async extract(urls: string[]): Promise<PageText[]> {
      const safe = urls.filter(isFetchable);
      if (safe.length === 0) return [];
      const res = await withRetry("extract", () => client.extract(safe, { extractDepth: "basic", format: "text", timeout: CALL_TIMEOUT_MS / 1000 }));
      return (res.results ?? [])
        .filter((r) => httpUrl(r.url) && !!r.rawContent?.trim())
        .map((r) => ({ url: r.url, text: cleanText(r.rawContent).slice(0, MAX_PAGE_CHARS) }));
    },
  };
}

export function openAiProvider(apiKey = env().OPENAI_API_KEY, model = env().OPENAI_MODEL): LlmProvider {
  if (!apiKey) throw new ProviderNotConfigured("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2 });

  return {
    async structured({ name, schema, instructions, input, maxOutputTokens }) {
      const res = await client.responses.parse({
        model,
        instructions,
        input,
        text: { format: zodTextFormat(schema, name) },
        max_output_tokens: maxOutputTokens,
        store: false,
      });
      if (!res.output_parsed) throw new Error(`The model returned no structured output for ${name}`);
      return { value: res.output_parsed, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 };
    },
  };
}

export function liveProviders(): Providers {
  const collect = !!env().APIFY_TOKEN;
  return {
    search: tavilyProvider(),
    llm: openAiProvider(),
    posts: collect ? apifyPostProvider() : undefined,
    companies: collect ? apifyCompanyProvider() : undefined,
    jobs: collect ? apifyJobsProvider() : undefined,
    photos: collect ? apifyPhotoProvider() : undefined,
    profiles: collect ? { fetchProfile: (url) => apifyProfileProvider().fetchProfile(url) } : undefined,
  };
}
