import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log, runRef, setLogService, withLogContext } from "@/lib/log";
import { QUEUE_NAME, redisConnection, enqueue, type ResearchJob } from "@/lib/research/queue";
import { identifyPhase, researchPhase } from "@/lib/research/pipeline";
import { liveProviders } from "@/lib/research/providers";
import { fakeProviders } from "@/lib/research/fake-providers";
import { refreshDue } from "@/lib/team/refresh";
import { profileProvider } from "@/lib/team/provider";

setLogService("worker");

const providers = () => (env().RESEARCH_PROVIDERS === "fake" ? fakeProviders() : liveProviders());

async function handle(job: Job<ResearchJob>) {
  const { runId, phase } = job.data;
  return withLogContext({ runId, ref: runRef(runId), jobId: job.id, attempt: job.attemptsMade + 1 }, async () => {
    const start = Date.now();
    // How long the job waited in the queue; a growing value means the worker is saturated or was away.
    log.info("job.start", { phase, queuedMs: (job.processedOn ?? start) - job.timestamp });
    if (phase === "identify") {
      const next = await identifyPhase(runId, providers());
      if (next === "research") await enqueue({ runId, phase: "research" });
    } else {
      await researchPhase(runId, providers(), { approved: phase === "approved" });
    }
    log.info("job.done", { phase, ms: Date.now() - start });
  });
}

// Marks runs failed when a worker died mid-run, so the UI never spins forever.
async function sweepStuckRuns() {
  const staleBefore = new Date(Date.now() - (env().RESEARCH_MAX_SECONDS + 120) * 1000);
  const res = await db.researchRun.updateMany({
    where: { status: { in: ["QUEUED", "QUALIFYING", "IDENTIFYING", "RESEARCHING", "WRITING"] }, updatedAt: { lt: staleBefore } },
    data: { status: "FAILED", error: "The research stopped unexpectedly. Please try again.", finishedAt: new Date() },
  });
  if (res.count > 0) log.warn("worker.stuck_runs_failed", { count: res.count });
}

async function main() {
  const e = env();
  const connection = redisConnection();
  // Redis reports every failed reconnect attempt; log the first and then at most one a minute.
  let lastRedisLog = 0;
  connection.on("error", (err) => {
    if (Date.now() - lastRedisLog < 60_000) return;
    lastRedisLog = Date.now();
    log.warn("worker.redis_error", { err });
  });
  connection.on("ready", () => {
    lastRedisLog = 0;
    log.info("worker.redis_ready");
  });

  const worker = new Worker<ResearchJob>(QUEUE_NAME, handle, { connection, prefix: e.REDIS_PREFIX, concurrency: e.RESEARCH_CONCURRENCY });

  worker.on("failed", async (job, err) => {
    const final = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);
    log.error("job.failed", { runId: job?.data.runId, ref: job ? runRef(job.data.runId) : undefined, jobId: job?.id, phase: job?.data.phase, attempt: job?.attemptsMade, attempts: job?.opts.attempts, final, err });
    if (final && job) {
      await db.researchRun
        .updateMany({ where: { id: job.data.runId, status: { notIn: ["COMPLETE", "PARTIAL", "CANCELLED"] } }, data: { status: "FAILED", error: "The research could not be completed. Please try again.", finishedAt: new Date() } })
        .catch((dbErr) => log.error("job.mark_failed_error", { runId: job.data.runId, err: dbErr }));
    }
  });
  worker.on("stalled", (jobId) => log.warn("job.stalled", { jobId }));
  worker.on("error", (err) => log.error("worker.error", { err }));

  const timer = setInterval(() => void sweepStuckRuns().catch((err) => log.error("worker.sweep_failed", { err })), 60_000);

  // Team profiles: new and manually requested ones are fetched within seconds; the rest are refreshed weekly.
  let refreshing = false;
  const teamTimer = setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    refreshDue(profileProvider())
      .catch((err) => log.error("worker.team_refresh_failed", { err }))
      .finally(() => (refreshing = false));
  }, 10_000);
  log.info("worker.ready", { prefix: e.REDIS_PREFIX, providers: e.RESEARCH_PROVIDERS, concurrency: e.RESEARCH_CONCURRENCY, postsEnabled: !!e.APIFY_TOKEN });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("worker.stopping", { signal });
    clearInterval(timer);
    clearInterval(teamTimer);
    // An unfinished job is picked up again by another attempt, so shutdown does not wait for it indefinitely.
    await Promise.race([worker.close(), new Promise((r) => setTimeout(r, 25_000))]).catch(() => undefined);
    await db.$disconnect().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop("SIGINT"));
  process.on("SIGTERM", () => void stop("SIGTERM"));
}

// Anything that escapes is logged with its cause and the process exits, so the process manager restarts it cleanly.
process.on("unhandledRejection", (err) => {
  log.error("worker.unhandled_rejection", { err });
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  log.error("worker.uncaught_exception", { err });
  process.exit(1);
});

main().catch((err) => {
  log.error("worker.fatal", { err });
  process.exit(1);
});
