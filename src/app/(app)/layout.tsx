import Link from "next/link";
import { Suspense } from "react";
import clsx from "clsx";
import { LogOut, Plus } from "lucide-react";
import { Logo, buttonClass } from "@/components/ui";
import { DesktopNav, MobileNav } from "@/components/nav";
import { QuickSearch } from "@/components/quick-search";
import { ShellSkeleton } from "@/components/skeletons";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <AppFrame>{children}</AppFrame>
    </Suspense>
  );
}

async function AppFrame({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Sales Intelligence home" className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">Sales Intelligence</span>
          </Link>
          <DesktopNav isAdmin={isAdmin} />
          <div className="ml-auto flex items-center gap-2">
            <QuickSearch />
            <Link href="/leads/new" className={clsx(buttonClass({ size: "sm" }), "max-md:hidden")}>
              <Plus className="size-4" aria-hidden /> New brief
            </Link>
            <span className="hidden max-w-48 truncate text-sm text-muted lg:inline" title={user.email}>
              {user.email}
            </span>
            <form action={logout}>
              <button
                type="submit"
                aria-label="Sign out"
                title="Sign out"
                className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-28 sm:px-6 md:py-10 md:pb-10">{children}</main>
      <MobileNav isAdmin={isAdmin} />
    </div>
  );
}
