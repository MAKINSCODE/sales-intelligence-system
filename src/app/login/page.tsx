import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthShell title="Sign in" subtitle="Turn a lead's name into a source-backed meeting brief. We will email you a one-time link.">
      <Suspense fallback={<div aria-hidden className="skeleton h-28" />}>
        <LoginBody searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await getCurrentUser()) redirect("/");
  const { error } = await searchParams;
  return <LoginForm expired={error === "expired"} />;
}
