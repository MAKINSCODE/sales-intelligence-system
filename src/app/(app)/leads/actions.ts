"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { requireUser } from "@/lib/auth/session";
import { leadSchema, type LeadFieldErrors } from "@/lib/leads";
import { RunError, startRun } from "@/lib/research/runs";

export type LeadFormState = {
  errors?: LeadFieldErrors;
  values?: Record<string, string>;
  message?: string;
};

const FIELDS = ["firstName", "lastName", "company", "jobTitle", "profileUrl", "email", "country", "enquiryText", "notes"] as const;

export async function createLead(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  const user = await requireUser();

  const values = Object.fromEntries(FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  const parsed = leadSchema.safeParse(values);
  if (!parsed.success) {
    const errors: LeadFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof LeadFieldErrors;
      errors[key] ??= issue.message;
    }
    return { errors, values, message: "Please fix the highlighted fields." };
  }

  let id: string;
  try {
    ({ id } = await db.lead.create({ data: { ...parsed.data, createdById: user.id }, select: { id: true } }));
  } catch (err) {
    log.error("lead.create_failed", { userId: user.id, err });
    // The typed values are returned so a database hiccup does not cost the person their input.
    return { values, message: "The lead could not be saved right now. Please try again." };
  }
  redirect(`/leads/${id}`);
}

export type QuickBriefResult = { ok: true; id: string; started: boolean } | { ok: false; error: string };

// Header quick search: opens the person's existing brief for this name, or creates the lead and starts one.
export async function quickBrief(firstName: string, lastName: string, forMemberId: string | null = null): Promise<QuickBriefResult> {
  const user = await requireUser();
  const parsed = leadSchema.pick({ firstName: true, lastName: true }).safeParse({ firstName, lastName });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Enter a first name and surname." };
  const { firstName: first, lastName: last } = parsed.data;

  try {
    const matches = await db.lead.findMany({
      where: {
        createdById: user.id,
        status: { not: "ARCHIVED" },
        firstName: { equals: first, mode: "insensitive" },
        lastName: { equals: last, mode: "insensitive" },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, _count: { select: { runs: true } } },
    });
    const existing = matches.find((m) => m._count.runs > 0);
    if (existing) return { ok: true, id: existing.id, started: false };

    const id = matches[0]?.id ?? (await db.lead.create({ data: { firstName: first, lastName: last, createdById: user.id }, select: { id: true } })).id;
    await startRun(id, user.id, { bypassScreen: true, forMemberId });
    return { ok: true, id, started: true };
  } catch (err) {
    if (err instanceof RunError) return { ok: false, error: err.message };
    log.error("lead.quick_brief_failed", { userId: user.id, err });
    return { ok: false, error: "The search could not be run right now. Please try again." };
  }
}
