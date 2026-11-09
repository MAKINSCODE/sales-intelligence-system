import { describe, expect, it } from "vitest";
import { createLogger, runRef, scrub, serializeError, timed, withLogContext, type Fields } from "./log";

function capture(options: Parameters<typeof createLogger>[1] = {}, bindings: Fields = {}) {
  const lines: string[] = [];
  const logger = createLogger(bindings, { level: "debug", format: "json", color: false, stacks: false, ...options, write: (l) => lines.push(l) });
  const records = () => lines.map((l) => JSON.parse(l) as Fields);
  return { logger, lines, records };
}

describe("record shape", () => {
  it("writes one JSON object per line with time, level, service and event first", () => {
    const { logger, lines, records } = capture();
    logger.info("run.phase.done", { ms: 12, next: "research" });
    expect(lines).toHaveLength(1);
    expect(Object.keys(records()[0]).slice(0, 4)).toEqual(["ts", "level", "service", "event"]);
    expect(records()[0]).toMatchObject({ level: "info", event: "run.phase.done", ms: 12, next: "research" });
    expect(new Date(records()[0].ts as string).toISOString()).toBe(records()[0].ts);
  });

  it("carries the run context to every record written inside it, including after awaits", async () => {
    const { logger, records } = capture();
    await withLogContext({ runId: "run_abc12345", ref: "abc12345" }, async () => {
      logger.info("a");
      await new Promise((r) => setTimeout(r, 5));
      logger.warn("b");
    });
    logger.info("outside");
    const [a, b, outside] = records();
    expect(a).toMatchObject({ runId: "run_abc12345", ref: "abc12345" });
    expect(b).toMatchObject({ runId: "run_abc12345", level: "warn" });
    expect(outside.runId).toBeUndefined();
  });

  it("keeps concurrent runs apart", async () => {
    const { logger, records } = capture();
    await Promise.all(
      ["one", "two"].map((ref, i) =>
        withLogContext({ ref }, async () => {
          await new Promise((r) => setTimeout(r, i ? 1 : 8));
          logger.info("step");
        }),
      ),
    );
    expect(records().map((r) => r.ref).sort()).toEqual(["one", "two"]);
  });

  it("merges child bindings and does not let a field overwrite the time, level or event", () => {
    const { logger, records } = capture({}, { component: "x" });
    logger.child({ provider: "search" }).info("provider.call", { ts: "forged", level: "debug", event: "forged" });
    expect(records()[0]).toMatchObject({ component: "x", provider: "search", level: "info", event: "provider.call" });
    expect(records()[0].ts).not.toBe("forged");
  });

  it("skips records below the configured level", () => {
    const { logger, lines } = capture({ level: "warn" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(lines).toHaveLength(2);
  });

  it("is silent when switched off", () => {
    const { logger, lines } = capture({ level: "silent" });
    logger.error("e");
    expect(lines).toHaveLength(0);
  });

  it("never throws, even for circular data, bigint or a failing sink", () => {
    const loop: Fields = {};
    loop.self = loop;
    const { logger, lines } = capture();
    expect(() => logger.info("x", { loop, big: BigInt(5), fn: () => 1, sym: Symbol("s") })).not.toThrow();
    expect(lines).toHaveLength(1);
    const broken = createLogger({}, { level: "debug", format: "json", write: () => { throw new Error("disk full"); } });
    expect(() => broken.error("x")).not.toThrow();
  });
});

describe("secrets and personal data", () => {
  it("redacts sensitive keys but keeps token counts", () => {
    const { logger, records } = capture();
    logger.info("x", { apiKey: "k", password: "p", authorization: "Bearer abc", sessionToken: "t", token: "t2", nested: { secret: "s", ok: 1 }, inputTokens: 100, outputTokens: 20 });
    expect(records()[0]).toMatchObject({ apiKey: "[redacted]", password: "[redacted]", authorization: "[redacted]", sessionToken: "[redacted]", token: "[redacted]", nested: { secret: "[redacted]", ok: 1 }, inputTokens: 100, outputTokens: 20 });
  });

  it("removes keys, bearer values and token parameters from text", () => {
    expect(scrub("Incorrect API key provided: sk-proj-abcdefghijkl1234")).not.toContain("abcdefghijkl");
    expect(scrub("Authorization: Bearer abcdefghijklmnop")).toBe("Authorization: Bearer [redacted]");
    expect(scrub("token apify_api_ABCdef123456 rejected")).not.toContain("ABCdef");
    expect(scrub("tvly-dev-AbCdEf123 is invalid")).not.toContain("AbCdEf");
    expect(scrub("GET /auth/verify?token=abc123&x=1")).toBe("GET /auth/verify?token=[redacted]&x=1");
  });

  it("masks email addresses", () => {
    expect(scrub("sent to john.doe@citybureau.example.gov ok")).toBe("sent to j***@citybureau.example.gov ok");
    const { logger, lines } = capture();
    logger.info("mail.sent", { to: "alex.johnson@example.com" });
    expect(lines[0]).not.toContain("alex.johnson");
  });

  it("scrubs the message of an error", () => {
    const { logger, records } = capture();
    logger.error("provider.call", { err: new Error("401 Incorrect API key provided: sk-abcdefghijklmnop") });
    expect(JSON.stringify(records()[0])).not.toContain("abcdefghijklmnop");
  });
});

describe("errors", () => {
  it("keeps the useful parts of a provider error and drops the request that caused it", () => {
    const err = Object.assign(new Error("Request failed with status code 429"), {
      name: "AxiosError",
      code: "ERR_BAD_REQUEST",
      response: { status: 429, data: { detail: "slow down" }, config: { headers: { Authorization: "Bearer supersecretvalue" } } },
      config: { headers: { Authorization: "Bearer supersecretvalue" } },
    });
    const out = serializeError(err);
    expect(out).toEqual({ name: "AxiosError", message: "Request failed with status code 429", code: "ERR_BAD_REQUEST", status: 429 });
    expect(JSON.stringify(out)).not.toContain("supersecret");
  });

  it("records the cause, the provider request id and (when asked) a short stack", () => {
    const err = Object.assign(new Error("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), { code: "ECONNREFUSED" }) }), { requestID: "req_123" });
    const out = serializeError(err, true);
    expect(out.cause).toContain("ECONNREFUSED");
    expect(out.providerRequestId).toBe("req_123");
    expect(typeof out.stack).toBe("string");
    expect((out.stack as string).split("\n").length).toBeLessThanOrEqual(6);
  });

  it("handles things that are not Error objects", () => {
    expect(serializeError("boom")).toEqual({ message: "boom" });
    expect(serializeError(undefined)).toEqual({ message: "undefined" });
    expect(serializeError({ odd: true })).toHaveProperty("message");
  });

  it("limits very long messages", () => {
    expect((serializeError(new Error("x".repeat(5000))).message as string).length).toBeLessThan(600);
  });
});

describe("readable output", () => {
  it("prints time, process, level, event and key=value pairs", () => {
    const { logger, lines } = capture({ format: "pretty" });
    logger.warn("provider.retry", { provider: "search", attempt: 2, note: "has space", err: Object.assign(new Error("timed out"), { status: 503 }) });
    expect(lines[0]).toMatch(/^\d\d:\d\d:\d\d\.\d{3} web WARN {2}provider\.retry {2}provider=search attempt=2 note="has space" err="Error: timed out" status=503/);
  });
});

describe("timed", () => {
  it("logs the duration on success and on failure, and rethrows the original error", async () => {
    const { logger, records } = capture();
    await expect(timed(logger, "step", { id: 1 }, async () => 7, (r) => ({ value: r }))).resolves.toBe(7);
    const boom = new Error("nope");
    await expect(timed(logger, "step", { id: 2 }, async () => { throw boom; })).rejects.toBe(boom);
    const [ok, failed] = records();
    expect(ok).toMatchObject({ event: "step.ok", id: 1, value: 7, level: "info" });
    expect(typeof ok.ms).toBe("number");
    expect(failed).toMatchObject({ event: "step.failed", id: 2, level: "error" });
  });
});

describe("runRef", () => {
  it("is the last eight characters, which differ between runs even when ids share a prefix", () => {
    expect(runRef("cmgx0a1b2c3d4e5f6g7h8i9j")).toBe("6g7h8i9j");
  });
});
