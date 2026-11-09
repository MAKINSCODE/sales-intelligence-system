// Failures worth trying again: a dropped connection, a timeout, rate limiting or a provider-side error. A bad key,
// a rejected request or an exhausted plan will fail the same way again, so those are never retried.

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);
// Only failures where the request cannot have reached the provider, so a retry cannot repeat paid work.
const NEVER_REACHED = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const TIMEOUT_TEXT = /timed out|timeout|aborted due to timeout/i;
const NETWORK_TEXT = /ECONN(?:RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|network error|fetch failed|connection (?:error|reset|closed)|temporarily unavailable|overloaded|rate limit|too many requests|\b(?:429|5\d\d) error\b/i;

export function httpStatusOf(e: unknown): number | undefined {
  const x = e as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  for (const v of [x?.status, x?.statusCode, x?.response?.status]) if (typeof v === "number") return v;
  return undefined;
}

function codeOf(e: unknown): string | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = x?.code ?? x?.cause?.code;
  return typeof c === "string" ? c : undefined;
}

export const isTimeout = (e: unknown) => {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return true;
  return e instanceof Error && TIMEOUT_TEXT.test(e.message);
};

export function isTransient(e: unknown): boolean {
  const status = httpStatusOf(e);
  if (status !== undefined) return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  const code = codeOf(e);
  if (code && NETWORK_CODES.has(code)) return true;
  if (isTimeout(e)) return true;
  return e instanceof Error && (NETWORK_TEXT.test(e.message) || NETWORK_TEXT.test(String((e as { cause?: unknown }).cause ?? "")));
}

// For calls that start billable work on the provider: retried only when the request demonstrably never arrived
// or the provider said it was busy before starting.
export function isSafeToRepeat(e: unknown): boolean {
  const status = httpStatusOf(e);
  if (status !== undefined) return status === 429 || status === 502 || status === 503;
  const code = codeOf(e);
  return !!code && NEVER_REACHED.has(code);
}

function retryAfterMs(e: unknown): number | undefined {
  const x = e as { headers?: unknown; response?: { headers?: unknown } } | null;
  for (const h of [x?.headers, x?.response?.headers] as unknown[]) {
    if (!h) continue;
    const raw = typeof (h as Headers).get === "function" ? (h as Headers).get("retry-after") : (h as Record<string, unknown>)["retry-after"];
    const s = Number(raw);
    if (Number.isFinite(s) && s >= 0) return s * 1000;
  }
  return undefined;
}

export type RetryInfo = { attempt: number; delayMs: number; err: unknown };

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  shouldRetry?: (e: unknown) => boolean;
  // Retrying stops when the wait would not fit in the time that is left.
  remainingMs?: () => number;
  onRetry?: (info: RetryInfo) => void;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 2, baseMs = 500, maxMs = 5000, shouldRetry = isTransient, remainingMs, onRetry, sleep = wait, random = Math.random } = opts;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > retries || !shouldRetry(err)) throw err;
      // Exponential backoff with jitter, so many clients recovering from one outage do not all return together.
      const backoff = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      const delayMs = Math.min(maxMs, retryAfterMs(err) ?? Math.round(backoff / 2 + random() * (backoff / 2)));
      if (remainingMs && delayMs >= remainingMs()) throw err;
      onRetry?.({ attempt, delayMs, err });
      await sleep(delayMs);
    }
  }
}
