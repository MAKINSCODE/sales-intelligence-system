"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { sendSignInLink } from "@/lib/mail";
import { hashToken } from "@/lib/auth/tokens";
import { createSession, destroySession } from "@/lib/auth/session";
import {
  SIGN_IN_TTL_MINUTES,
  bootstrapAdminEmails,
  isRateLimited,
  issueLoginLink,
  normalizeEmail,
} from "@/lib/auth/login";

export type LoginState = {
  status: "idle" | "sent" | "error";
  message?: string;
  devLink?: string;
};

const emailSchema = z.string().trim().pipe(z.email());

export async function requestLogin(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { status: "error", message: "Enter a valid email address." };
  }
  const email = normalizeEmail(parsed.data);

  let user = await db.user.findUnique({ where: { email } });
  if (!user && bootstrapAdminEmails().includes(email)) {
    user = await db.user.create({ data: { email, role: "ADMIN" } });
  }

  // The same response is returned whether or not the address has access.
  const generic: LoginState = {
    status: "sent",
    message: "If this email has access, a sign-in link is on its way.",
  };
  if (!user || user.status === "REVOKED" || (await isRateLimited(user.id))) {
    return generic;
  }

  const url = await issueLoginLink(user.id, SIGN_IN_TTL_MINUTES);
  try {
    const { delivered } = await sendSignInLink(user.email, url);
    if (!delivered && env().DEV_SHOW_MAGIC_LINK) return { ...generic, devLink: url };
  } catch (error) {
    log.error("auth.signin_email_failed", { userId: user.id, err: error });
    // Development only (the setting is refused in production): the link is still usable when mail is down.
    if (env().DEV_SHOW_MAGIC_LINK) return { ...generic, message: "The email could not be sent, so the link is shown here instead.", devLink: url };
    return { status: "error", message: "We could not send the email. Please try again shortly." };
  }
  return env().DEV_SHOW_MAGIC_LINK ? { ...generic, devLink: url } : generic;
}

export async function completeLogin(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const tokenHash = hashToken(token);

  // Atomic single-use consumption.
  const consumed = await db.loginToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) redirect("/login?error=expired");

  const record = await db.loginToken.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!record || record.user.status === "REVOKED") redirect("/login?error=expired");

  await db.user.update({
    where: { id: record.userId },
    data: { status: "ACTIVE", lastLoginAt: new Date() },
  });
  await createSession(record.userId, (await headers()).get("user-agent"));
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
