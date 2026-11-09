import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLogger } from "@/lib/log";
import { Budget, BudgetExceeded, withBudget } from "./budget";
import type { Limits, Providers } from "./types";

const limits: Limits = { maxSeconds: 60, maxSearches: 2, maxPages: 3, maxLlmCalls: 2, maxPostRuns: 1, maxPosts: 12, maxInputTokensPerCall: 100, maxOutputTokensPerCall: 500 };

function fakeProviders() {
  const search = vi.fn().mockResolvedValue([]);
  const extract = vi.fn().mockImplementation(async (urls: string[]) => urls.map((url) => ({ url, text: "t" })));
  const structured = vi.fn().mockResolvedValue({ value: { ok: true }, inputTokens: 10, outputTokens: 5 });
  const providers: Providers = { search: { search, extract }, llm: { structured } };
  return { providers, search, extract, structured };
}

describe("Budget", () => {
  it("stops searches at the limit and counts the attempt", async () => {
    const f = fakeProviders();
    const p = withBudget(f.providers, new Budget(limits));
    await p.search.search("a", { maxResults: 3 });
    await p.search.search("b", { maxResults: 3 });
    await expect(p.search.search("c", { maxResults: 3 })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(f.search).toHaveBeenCalledTimes(2);
  });

  it("counts a failed call against the budget so retries cannot loop forever", async () => {
    const f = fakeProviders();
    f.search.mockRejectedValue(new Error("network"));
    const b = new Budget(limits);
    const p = withBudget(f.providers, b);
    await expect(p.search.search("a", { maxResults: 3 })).rejects.toThrow("network");
    expect(b.usage.searches).toBe(1);
  });

  it("only fetches as many pages as the budget allows", async () => {
    const f = fakeProviders();
    const b = new Budget(limits);
    const p = withBudget(f.providers, b);
    const first = await p.search.extract(["a", "b"]);
    const second = await p.search.extract(["c", "d", "e"]);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(1);
    await expect(p.search.extract(["f"])).rejects.toBeInstanceOf(BudgetExceeded);
    expect(b.usage.pagesFetched).toBe(3);
  });

  it("caps LLM calls, clamps output tokens, truncates input and records tokens", async () => {
    const f = fakeProviders();
    const b = new Budget(limits);
    const p = withBudget(f.providers, b);
    await p.llm.structured({ name: "x", schema: z.object({ ok: z.boolean() }), instructions: "i", input: "x".repeat(5000), maxOutputTokens: 9999 });
    const call = f.structured.mock.calls[0][0];
    expect(call.maxOutputTokens).toBe(500);
    expect(call.input.length).toBeLessThan(400);
    expect(b.usage).toMatchObject({ llmCalls: 1, inputTokens: 10, outputTokens: 5 });
    await p.llm.structured({ name: "x", schema: z.object({ ok: z.boolean() }), instructions: "i", input: "y", maxOutputTokens: 10 });
    await expect(p.llm.structured({ name: "x", schema: z.object({ ok: z.boolean() }), instructions: "i", input: "z", maxOutputTokens: 10 })).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it("refuses all work once the deadline passes", async () => {
    let now = 1_000;
    const b = new Budget(limits, 1_000, undefined, () => now);
    const p = withBudget(fakeProviders().providers, b);
    await p.search.search("a", { maxResults: 1 });
    now += 61_000;
    expect(b.remainingMs()).toBe(0);
    expect(b.canSearch()).toBe(false);
    await expect(p.search.search("b", { maxResults: 1 })).rejects.toMatchObject({ resource: "time" });
  });

  it("resumes from previously recorded usage", () => {
    const b = new Budget(limits, Date.now(), { searches: 2 });
    expect(b.canSearch()).toBe(false);
  });

  it("notifies after each spend so usage can be persisted", async () => {
    const onSpend = vi.fn().mockResolvedValue(undefined);
    const p = withBudget(fakeProviders().providers, new Budget(limits), onSpend);
    await p.search.search("a", { maxResults: 1 });
    expect(onSpend).toHaveBeenCalledTimes(1);
  });
});

describe("slow or dropped connections", () => {
  const search = { maxResults: 3 };

  it("cuts off a provider that never answers at the time limit", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeProviders();
      f.search.mockReturnValue(new Promise(() => undefined));
      const p = withBudget(f.providers, new Budget({ ...limits, maxSeconds: 1 }));
      const outcome = p.search.search("a", search).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(await outcome).toBeInstanceOf(BudgetExceeded);
      expect(await outcome).toMatchObject({ resource: "time" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leak an unhandled rejection when an abandoned call fails after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const f = fakeProviders();
      f.search.mockReturnValue(new Promise((_, reject) => setTimeout(() => reject(new Error("socket hang up")), 2_000)));
      const p = withBudget(f.providers, new Budget({ ...limits, maxSeconds: 1 }));
      const outcome = p.search.search("a", search).catch((e) => e);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(await outcome).toBeInstanceOf(BudgetExceeded);
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a call that finishes in time is unaffected", async () => {
    const f = fakeProviders();
    f.search.mockResolvedValue([{ id: "1", url: "https://a.example", title: "t", snippet: "s", score: 1, publishedDate: null }]);
    const p = withBudget(f.providers, new Budget(limits));
    await expect(p.search.search("a", search)).resolves.toHaveLength(1);
  });
});

describe("call log", () => {
  function capture() {
    const lines: string[] = [];
    const logger = createLogger({}, { level: "info", format: "json", write: (l) => lines.push(l) });
    return { logger, records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>), lines };
  }

  it("writes one record per provider call with its duration and result size, and never the query", async () => {
    const f = fakeProviders();
    f.search.mockResolvedValue([{ id: "1", url: "https://a.example", title: "t", snippet: "s", score: 1, publishedDate: null }]);
    const c = capture();
    const p = withBudget(f.providers, new Budget(limits), undefined, c.logger);
    await p.search.search("James Harrison City Bureau", { maxResults: 3 });
    await p.llm.structured({ name: "identity", schema: z.object({ ok: z.boolean() }), instructions: "i", input: "x", maxOutputTokens: 10 });
    const [search, llm] = c.records();
    expect(search).toMatchObject({ event: "provider.call", provider: "search", ok: true, results: 1, level: "info" });
    expect(typeof search.ms).toBe("number");
    expect(llm).toMatchObject({ provider: "llm", name: "identity", ok: true, inputTokens: 10, outputTokens: 5 });
    expect(c.lines.join("\n")).not.toContain("James");
  });

  it("records a failure as an error with the cause, and a spent budget as a warning with the limit", async () => {
    const f = fakeProviders();
    f.search.mockRejectedValue(Object.assign(new Error("Request timed out after 30 seconds."), { code: "ECONNABORTED" }));
    const c = capture();
    const p = withBudget(f.providers, new Budget({ ...limits, maxSearches: 1 }), undefined, c.logger);
    await expect(p.search.search("a", { maxResults: 1 })).rejects.toThrow(/timed out/);
    await expect(p.search.search("b", { maxResults: 1 })).rejects.toBeInstanceOf(BudgetExceeded);
    const [failed, limited] = c.records();
    expect(failed).toMatchObject({ provider: "search", ok: false, level: "error", err: { code: "ECONNABORTED" } });
    expect(limited).toMatchObject({ provider: "search", ok: false, level: "warn", limit: "searches" });
    expect(limited.err).toBeUndefined();
  });
});
