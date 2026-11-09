"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { addTeamProfiles, removeTeamProfile, requestRefresh } from "@/lib/team/service";

export type AddState = { status: "idle" | "done" | "error"; message?: string; added?: number; existing?: number; invalid?: string[] };

const MAX_INPUT = 5_000;

export async function addTeamProfilesAction(_prev: AddState, formData: FormData): Promise<AddState> {
  const admin = await requireAdmin();
  const text = String(formData.get("urls") ?? "").slice(0, MAX_INPUT);
  if (!text.trim()) return { status: "error", message: "Paste at least one LinkedIn profile address." };

  const r = await addTeamProfiles(text, admin.id);
  revalidatePath("/reference");
  if (r.added.length === 0 && r.existing.length === 0) return { status: "error", message: "None of those are LinkedIn profile addresses.", invalid: r.invalid };
  return {
    status: "done",
    added: r.added.length,
    existing: r.existing.length,
    invalid: r.invalid,
    message: r.overLimit ? "The team list is full, so some addresses were not added." : undefined,
  };
}

export type RowResult = { error?: string };

export async function removeTeamProfileAction(id: string): Promise<RowResult> {
  await requireAdmin();
  await removeTeamProfile(id);
  revalidatePath("/reference");
  return {};
}

export async function refreshTeamProfileAction(id?: string): Promise<RowResult> {
  await requireAdmin();
  await requestRefresh(id);
  revalidatePath("/reference");
  return {};
}
