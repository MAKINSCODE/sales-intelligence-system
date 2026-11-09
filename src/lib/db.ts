import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const pool = new Pool({
    connectionString: env().DATABASE_URL,
    max: 10,
    // A database across a slow or lossy link: fail a connect attempt in seconds, notice dead sockets, drop idle ones.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  // An idle connection dropped by the network emits "error"; without a listener that would crash the process.
  pool.on("error", (err) => log.warn("db.pool_error", { err }));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalForPrisma.prisma ?? create();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
