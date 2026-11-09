import { describe, expect, it, vi } from "vitest";
import { isSafeToRepeat, isTransient, retry } from "./retry";

const http = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status}`), { status, ...extra });
const net = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

describe("isTransient", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("retries HTTP %i", (s) => expect(isTransient(http(s))).toBe(true));
  it.each([400, 401, 402, 403, 404, 422])("does not retry HTTP %i", (s) => expect(isTransient(http(s))).toBe(false));
  it.each(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_SOCKET"])("retries %s", (c) => expect(isTransient(net(c))).toBe(true));
  it("sees the code on the cause, as fetch reports it", () => {
    expect(isTransient(new TypeError("fetch failed", { cause: net("ECONNRESET") }))).toBe(true);
  });
  it("retries timeouts, however they are worded", () => {
    expect(isTransient(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(isTransient(new Error("Request timed out after 30 seconds."))).toBe(true);
    expect(isTransient(new Error("429 Error: {}"))).toBe(true);
  });
  it("does not retry a plan limit, a bad key or an ordinary bug", () => {
    expect(isTransient(new Error("This request exceeds your plan's set usage limit."))).toBe(false);
    expect(isTransient(new Error("Unauthorized: missing or invalid API key."))).toBe(false);
    expect(isTransient(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isTransient("string")).toBe(false);
    expect(isTransient(null)).toBe(false);
  });
});

describe("isSafeToRepeat (paid work)", () => {
  it("only repeats when the request cannot have started the work", () => {
    expect(isSafeToRepeat(http(503))).toBe(true);
    expect(isSafeToRepeat(http(429))).toBe(true);
    expect(isSafeToRepeat(net("ENOTFOUND"))).toBe(true);
    expect(isSafeToRepeat(new TypeError("fetch failed", { cause: net("ECONNREFUSED") }))).toBe(true);
    expect(isSafeToRepeat(new TypeError("fetch failed", { cause: net("UND_ERR_CONNECT_TIMEOUT") }))).toBe(true);
    expect(isSafeToRepeat(http(500))).toBe(false);
    expect(isSafeToRepeat(http(504))).toBe(false);
    expect(isSafeToRepeat(net("ECONNRESET"))).toBe(false);
    expect(isSafeToRepeat(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe(false);
  });
});

describe("retry", () => {
  const instant = { sleep: async () => undefined, random: () => 0.5 };

  it("returns the first success without waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(retry(fn, instant)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("recovers after transient failures and reports each retry", async () => {
    const fn = vi.fn().mockRejectedValueOnce(http(503)).mockRejectedValueOnce(net("ECONNRESET")).mockResolvedValue("ok");
    const onRetry = vi.fn();
    await expect(retry(fn, { ...instant, onRetry })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((c) => c[0].attempt)).toEqual([1, 2]);
  });

  it("gives up after the allowed retries and throws the last error", async () => {
    const last = http(502);
    const fn = vi.fn().mockRejectedValueOnce(http(503)).mockRejectedValue(last);
    await expect(retry(fn, { ...instant, retries: 2 })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry errors that would fail the same way again", async () => {
    const fn = vi.fn().mockRejectedValue(http(401));
    await expect(retry(fn, instant)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("backs off exponentially with jitter, capped", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(http(503));
    await retry(fn, { retries: 4, baseMs: 100, maxMs: 500, random: () => 1, sleep: async (ms) => void delays.push(ms) }).catch(() => undefined);
    expect(delays).toEqual([100, 200, 400, 500]);
    const low: number[] = [];
    await retry(fn, { retries: 2, baseMs: 100, maxMs: 500, random: () => 0, sleep: async (ms) => void low.push(ms) }).catch(() => undefined);
    expect(low).toEqual([50, 100]);
  });

  it("honours Retry-After, but never longer than the cap", async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValueOnce(http(429, { headers: new Headers({ "retry-after": "2" }) })).mockRejectedValueOnce(http(429, { response: { status: 429, headers: { "retry-after": "120" } } })).mockResolvedValue("ok");
    await retry(fn, { retries: 3, baseMs: 100, maxMs: 5000, sleep: async (ms) => void delays.push(ms) });
    expect(delays).toEqual([2000, 5000]);
  });

  it("stops retrying when the wait would not fit in the time left", async () => {
    const fn = vi.fn().mockRejectedValue(http(503));
    await expect(retry(fn, { ...instant, retries: 5, baseMs: 1000, remainingMs: () => 300 })).rejects.toMatchObject({ status: 503 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
