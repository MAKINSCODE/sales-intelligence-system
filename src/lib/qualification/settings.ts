import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, type QualSettings } from "./rules";

const list = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\r\n,;]+/).map((s) => s.trim()).filter(Boolean) : v),
  z.array(z.string().max(80, "Keep each phrase under 80 characters")).transform((a) => [...new Set(a)]).pipe(z.array(z.string()).max(50, "Use at most 50 entries")),
);

const count = (message: string) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number({ error: message }).int(message).min(0, message).max(10_000_000, message));

export const settingsSchema = z.object({
  minEmployees: count("Enter a number of employees"),
  minRevenueUsdM: count("Enter a revenue in USD millions"),
  strongKeywords: list.pipe(z.array(z.string()).min(1, "Add at least one target phrase")),
  weakKeywords: list,
  exceptionSectors: list,
});

export async function getSettings(): Promise<QualSettings> {
  const row = await db.qualificationSettings.findUnique({ where: { id: "default" } });
  if (!row) return DEFAULT_SETTINGS;
  return { minEmployees: row.minEmployees, minRevenueUsdM: row.minRevenueUsdM, strongKeywords: row.strongKeywords, weakKeywords: row.weakKeywords, exceptionSectors: row.exceptionSectors };
}

export async function saveSettings(s: QualSettings, adminId: string) {
  await db.qualificationSettings.upsert({ where: { id: "default" }, create: { id: "default", ...s, updatedById: adminId }, update: { ...s, updatedById: adminId } });
}
