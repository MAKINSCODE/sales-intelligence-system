import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export const QUEUE_NAME = "research";

// "approved" continues research for a run that a person approved after the qualification check; it needs its own job id because "research" already ran.
export type ResearchJob = { runId: string; phase: "identify" | "approved" | "research" };

const globalForQueue = globalThis as unknown as { researchQueue?: Queue<ResearchJob>; researchConn?: IORedis };

// The worker blocks waiting for jobs, so it keeps retrying for as long as Redis is away.
export function redisConnection() {
  return new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

// The web process must fail fast instead of hanging a user's click when Redis is unreachable.
function producerConnection() {
  return new IORedis(env().REDIS_URL, { maxRetriesPerRequest: 2, connectTimeout: 5_000, retryStrategy: (times) => Math.min(times * 300, 2_000) });
}

export function researchQueue() {
  if (!globalForQueue.researchQueue) {
    globalForQueue.researchConn = producerConnection();
    // Redis reports every failed reconnect; log the first and then at most one a minute.
    let lastLogged = 0;
    globalForQueue.researchConn.on("error", (err) => {
      if (Date.now() - lastLogged < 60_000) return;
      lastLogged = Date.now();
      log.warn("queue.redis_error", { err });
    });
    globalForQueue.researchQueue = new Queue<ResearchJob>(QUEUE_NAME, {
      connection: globalForQueue.researchConn,
      prefix: env().REDIS_PREFIX,
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: 200, removeOnFail: 500 },
    });
  }
  return globalForQueue.researchQueue;
}

export class QueueUnavailable extends Error {
  constructor() {
    super("The research service is not reachable right now.");
  }
}

const ENQUEUE_TIMEOUT_MS = 8_000;

// A run has exactly one identify and one research phase, so a fixed id makes a duplicate enqueue a no-op.
export async function enqueue(job: ResearchJob) {
  const jobId = `${job.runId}-${job.phase}`;
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const add = researchQueue().add(job.phase, job, { jobId });
    add.catch(() => undefined);
    await Promise.race([add, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("Timed out adding the job to the queue")), ENQUEUE_TIMEOUT_MS)))]);
    log.info("queue.enqueued", { jobId, phase: job.phase, ms: Date.now() - start });
  } catch (err) {
    log.error("queue.enqueue_failed", { jobId, phase: job.phase, ms: Date.now() - start, err });
    throw new QueueUnavailable();
  } finally {
    clearTimeout(timer);
  }
}
