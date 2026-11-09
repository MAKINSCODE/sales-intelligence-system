"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { sendInvite } from "@/lib/mail";
import { requireAdmin } from "@/lib/auth/session";
import { INVITE_TTL_MINUTES, issueLoginLink, normalizeEmail } from "@/lib/auth/login";

export type InviteState = {
  status: "idle" | "done" | "error";
  message?: string;
  invited?: string[];
  skipped?: string[];
  invalid?: string[];
  failed?: string[];
  devLinks?: { email: string; url: string }[];
};

const MAX_INVITES = 50;

export async function inviteUsers(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const role = formData.get("role") === "ADMIN" ? "ADMIN" : "MEMBER";

  const raw = String(formData.get("emails") ?? "")
    .split(/[\s,;]+/)
    .map(normalizeEmail)
    .filter(Boolean);
  const unique = [...new Set(raw)];
  if (unique.length === 0) return { status: "error", message: "Enter at least one email address." };
  if (unique.length > MAX_INVITES) {
    return { status: "error", message: `Invite at most ${MAX_INVITES} people at a time.` };
  }

  const invalid = unique.filter((e) => !z.email().safeParse(e).success);
  const valid = unique.filter((e) => !invalid.includes(e));
  const result: InviteState = { status: "done", invited: [], skipped: [], invalid, failed: [], devLinks: [] };

  for (const email of valid) {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing && existing.status !== "REVOKED") {
      result.skipped!.push(email);
      continue;
    }
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data: { status: existing.lastLoginAt ? "ACTIVE" : "INVITED", role } })
      : await db.user.create({ data: { email, role, invitedById: admin.id } });

    const url = await issueLoginLink(user.id, INVITE_TTL_MINUTES);
    try {
      const { delivered } = await sendInvite(email, url, admin.name ?? admin.email);
      if (!delivered && env().DEV_SHOW_MAGIC_LINK) result.devLinks!.push({ email, url });
      result.invited!.push(email);
    } catch (error) {
      log.error("team.invite_email_failed", { userId: user.id, err: error });
      result.failed!.push(email);
    }
  }

  revalidatePath("/team");
  return result;
}

async function activeAdminCount() {
  return db.user.count({ where: { role: "ADMIN", status: { not: "REVOKED" } } });
}

export type RowResult = { error?: string };

export async function resendInvite(userId: string): Promise<RowResult> {
  const admin = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.status === "REVOKED") return { error: "User not found." };

  const url = await issueLoginLink(user.id, INVITE_TTL_MINUTES);
  try {
    await sendInvite(user.email, url, admin.name ?? admin.email);
  } catch (error) {
    log.error("team.invite_resend_failed", { userId: user.id, err: error });
    return { error: "The email could not be sent." };
  }
  return {};
}

export async function revokeAccess(userId: string): Promise<RowResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { error: "You cannot revoke your own access." };
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };
  if (user.role === "ADMIN" && (await activeAdminCount()) <= 1) {
    return { error: "At least one admin must keep access." };
  }
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { status: "REVOKED" } }),
    db.session.deleteMany({ where: { userId } }),
    db.loginToken.deleteMany({ where: { userId } }),
  ]);
  revalidatePath("/team");
  return {};
}

export async function restoreAccess(userId: string): Promise<RowResult> {
  await requireAdmin();
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found." };
  await db.user.update({ where: { id: userId }, data: { status: user.lastLoginAt ? "ACTIVE" : "INVITED" } });
  revalidatePath("/team");
  return {};
}

export async function setRole(userId: string, role: "ADMIN" | "MEMBER"): Promise<RowResult> {
  const admin = await requireAdmin();
  if (userId === admin.id && role !== "ADMIN") return { error: "You cannot remove your own admin role." };
  await db.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/team");
  return {};
}
