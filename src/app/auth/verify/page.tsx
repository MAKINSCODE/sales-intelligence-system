import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass } from "@/components/ui";
import { completeLogin } from "@/lib/auth/actions";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/auth/tokens";

export const metadata: Metadata = { title: "Confirm sign-in" };

export default function VerifyPage({ searchParams }: PageProps<"/auth/verify">) {
  return (
    <Suspense
      fallback={
        <AuthShell title="Confirm sign-in">
          <div aria-hidden className="skeleton h-12" />
        </AuthShell>
      }
    >
      <VerifyBody searchParams={searchParams} />
    </Suspense>
  );
}

async function VerifyBody({ searchParams }: { searchParams: PageProps<"/auth/verify">["searchParams"] }) {
  await connection();
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";

  // Read-only check; the token is only consumed when the button is pressed.
  const record = value
    ? await db.loginToken.findFirst({
        where: { tokenHash: hashToken(value), usedAt: null, expiresAt: { gt: new Date() } },
        include: { user: { select: { email: true, status: true } } },
      })
    : null;

  if (!record || record.user.status === "REVOKED") {
    return (
      <AuthShell title="Link expired" subtitle="This sign-in link is invalid, already used, or has expired.">
        <Link href="/login" className={buttonClass({ variant: "dark" })}>
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirm sign-in" subtitle={`Continue as ${record.user.email}.`}>
      <form action={completeLogin}>
        <input type="hidden" name="token" value={value} />
        <SubmitButton className="w-full" pendingLabel="Signing in">
          Continue
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
