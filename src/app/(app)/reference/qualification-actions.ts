"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { getSettings, saveSettings, settingsSchema } from "@/lib/qualification/settings";

export type SettingsState = { status: "idle" | "ok" | "error"; message?: string; errors?: string[] };

export async function saveQualificationAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const admin = await requireAdmin();
  const parsed = settingsSchema.safeParse({
    minEmployees: formData.get("minEmployees"),
    minRevenueUsdM: formData.get("minRevenueUsdM"),
    strongKeywords: String(formData.get("strongKeywords") ?? ""),
    weakKeywords: String(formData.get("weakKeywords") ?? ""),
    exceptionSectors: String(formData.get("exceptionSectors") ?? ""),
  });
  if (!parsed.success) return { status: "error", errors: [...new Set(parsed.error.issues.map((i) => i.message))] };

  const before = await getSettings();
  await saveSettings(parsed.data, admin.id);
  log.info("qualification.settings_saved", { minEmployees: [before.minEmployees, parsed.data.minEmployees], minRevenueUsdM: [before.minRevenueUsdM, parsed.data.minRevenueUsdM] });
  revalidatePath("/reference");
  return { status: "ok", message: "Saved. New briefs use these rules; existing briefs keep the rules they were judged by." };
}
