import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// One log record per line. Production writes JSON (for grep/jq/log shippers); development writes a readable line.
// Every record carries the context set by withLogContext (e.g. runId/ref), so one run can be followed across the
// web process and the worker with a single search.

export type Level = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;
export type Format = "json" | "pretty";

const RANK: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const RESERVED = new Set(["ts", "level", "service", "event"]);

export type LoggerOptions = { level?: Level | "silent"; format?: Format; write?: (line: string, level: Level) => void; stacks?: boolean; color?: boolean };

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

const store = new AsyncLocalStorage<Fields>();

// Names the process in every record ("web" or "worker"), so the two can be told apart in one combined log.
let service = process.env.LOG_SERVICE ?? "web";
export const setLogService = (name: string) => {
  service = name;
};

export function withLogContext<T>(fields: Fields, fn: () => T): T {
  return store.run({ ...store.getStore(), ...fields }, fn);
}

export const currentLogContext = () => store.getStore() ?? {};

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 8);

export { runRef } from "@/lib/run-ref";

const SECRET_KEY = /(password|passwd|secret|authorization|cookie|api[-_]?key|credential|session)|(^|[_-]|[a-z])token$/i;

const PATTERNS: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [redacted]"],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/\bapify_api_[A-Za-z0-9]+/g, "[redacted-key]"],
  [/\btvly-[A-Za-z0-9_-]+/g, "[redacted-key]"],
  [/([?&](?:token|key|api_key|apikey|access_token|auth|sig|signature)=)[^&\s"']+/gi, "$1[redacted]"],
  [/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g, "$1***@$2"],
];

// Secrets and personal addresses are removed from text before it is written, whatever put it there.
export function scrub(text: string): string {
  let out = text;
  for (const [re, to] of PATTERNS) out = out.replace(re, to);
  return out;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function serializeError(e: unknown, stacks = false): Fields {
  if (!(e instanceof Error)) return { message: clip(scrub(String(e)), 500) };
  const x = e as Error & { code?: unknown; status?: unknown; statusCode?: unknown; response?: { status?: unknown }; requestID?: unknown; cause?: unknown };
  const out: Fields = { name: e.name, message: clip(scrub(e.message), 500) };
  if (typeof x.code === "string" || typeof x.code === "number") out.code = x.code;
  const status = num(x.status) ?? num(x.statusCode) ?? num(x.response?.status);
  if (status !== undefined) out.status = status;
  if (typeof x.requestID === "string") out.providerRequestId = x.requestID;
  if (x.cause instanceof Error) {
    const code = (x.cause as { code?: unknown }).code;
    out.cause = `${x.cause.name}: ${clip(scrub(x.cause.message), 200)}${typeof code === "string" ? ` [${code}]` : ""}`;
  }
  // A timeout or an HTTP error is explained by its code and status; a stack is kept for the unexpected ones.
  if (stacks && out.status === undefined && out.code === undefined && e.stack) out.stack = scrub(e.stack.split("\n").slice(1, 7).map((l) => l.trim()).join("\n"));
  return out;
}

function clean(value: unknown, stacks: boolean, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return clip(scrub(value), 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return serializeError(value, stacks);
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v, stacks, depth + 1));
  if (typeof value === "object") {
    const out: Fields = {};
    for (const [k, v] of Object.entries(value as Fields).slice(0, 40)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : clean(v, stacks, depth + 1);
    return out;
  }
  return undefined;
}

function pairs(record: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(record)) if (v !== undefined) out[k] = v;
  return out;
}

const COLORS: Record<Level, string> = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" };

function pretty(rec: Fields, level: Level, color: boolean) {
  const { ts, event, err, stack, service: svc, ...rest } = rec as Fields & { ts: string; event: string; service: string; err?: Fields; stack?: string };
  const time = ts.slice(11, 23);
  const tag = level.toUpperCase().padEnd(5);
  const head = color ? `\x1b[90m${time} ${svc}\x1b[0m ${COLORS[level]}${tag}\x1b[0m \x1b[1m${event}\x1b[0m` : `${time} ${svc} ${tag} ${event}`;
  // The short ref identifies the run on a screen; the full ids and a first attempt are only noise here (JSON keeps them).
  const hide = new Set(["level", ...(rest.ref ? ["runId", "jobId"] : []), ...(rest.attempt === 1 ? ["attempt"] : [])]);
  const kv = Object.entries(rest)
    .filter(([k]) => !hide.has(k))
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}=${/\s|=|"/.test(s) ? JSON.stringify(s) : s}`;
    });
  if (err) kv.push(`err=${JSON.stringify(`${err.name ?? "Error"}: ${err.message}`)}${err.code !== undefined ? ` code=${err.code}` : ""}${err.status !== undefined ? ` status=${err.status}` : ""}${err.cause ? ` cause=${JSON.stringify(err.cause)}` : ""}`);
  const trace = (err?.stack as string | undefined) ?? stack;
  return `${head}  ${kv.join(" ")}${trace ? `\n${trace.split("\n").map((l) => `        ${l}`).join("\n")}` : ""}`;
}

function defaults(): Required<Pick<LoggerOptions, "level" | "format" | "stacks" | "color">> {
  const env = process.env;
  const level = (env.LOG_LEVEL ?? (env.VITEST ? "silent" : "info")).toLowerCase();
  const format = env.LOG_FORMAT === "json" || env.LOG_FORMAT === "pretty" ? env.LOG_FORMAT : env.NODE_ENV === "production" ? "json" : "pretty";
  return {
    level: level in RANK ? (level as Level | "silent") : "info",
    format,
    stacks: env.LOG_STACKS ? env.LOG_STACKS === "true" : level === "debug" || env.NODE_ENV !== "production",
    color: !!process.stdout.isTTY && !env.NO_COLOR,
  };
}

export function createLogger(bindings: Fields = {}, options: LoggerOptions = {}): Logger {
  const base = defaults();
  const level = options.level ?? base.level;
  const format = options.format ?? base.format;
  const stacks = options.stacks ?? base.stacks;
  const color = options.color ?? base.color;
  const write = options.write ?? ((line: string, lvl: Level) => (lvl === "error" || lvl === "warn" ? console.error(line) : console.log(line)));

  const emit = (lvl: Level, event: string, fields?: Fields) => {
    if (RANK[lvl] < RANK[level]) return;
    const merged: Fields = { ...store.getStore(), ...bindings, ...fields };
    const rec: Fields = { ts: new Date().toISOString(), level: lvl, service, event };
    for (const [k, v] of Object.entries(merged)) {
      if (RESERVED.has(k) || v === undefined) continue;
      rec[k] = SECRET_KEY.test(k) ? "[redacted]" : clean(v, stacks && lvl !== "debug");
    }
    try {
      write(format === "json" ? JSON.stringify(pairs(rec)) : pretty(pairs(rec), lvl, color), lvl);
    } catch {
      // Logging must never break the code path it observes.
    }
  };

  return {
    debug: (e, f) => emit("debug", e, f),
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
    child: (b) => createLogger({ ...bindings, ...b }, { level, format, stacks, color, write: options.write }),
  };
}

export const log = createLogger();

// Logs "<event>.ok" or "<event>.failed" with the duration, and rethrows the failure unchanged.
export async function timed<T>(logger: Logger, event: string, fields: Fields, fn: () => Promise<T>, after?: (result: T) => Fields): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.info(`${event}.ok`, { ...fields, ms: Date.now() - start, ...after?.(result) });
    return result;
  } catch (err) {
    logger.error(`${event}.failed`, { ...fields, ms: Date.now() - start, err });
    throw err;
  }
}
