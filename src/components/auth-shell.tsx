import type { ReactNode } from "react";
import { Logo } from "@/components/ui";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10">
        <Logo className="mb-10 self-start" />
        <div className="animate-fade-up">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <p className="px-5 pb-6 text-center text-xs text-muted">Internal tool. Access is by invitation only.</p>
    </main>
  );
}
