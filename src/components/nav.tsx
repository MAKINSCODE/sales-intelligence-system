"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { FileText, Plus, Users, UserRound } from "lucide-react";

type Item = { href: string; label: string; icon: typeof FileText; adminOnly?: boolean };

const items: Item[] = [
  { href: "/", label: "Briefs", icon: FileText },
  { href: "/reference", label: "Reference", icon: UserRound },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" || pathname.startsWith("/leads") : pathname.startsWith(href);
}

export function DesktopNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
      {items
        .filter((i) => !i.adminOnly || isAdmin)
        .map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            className={clsx(
              "rounded-lg px-3 py-2 text-sm font-medium transition",
              isActive(pathname, href) ? "bg-ink text-white" : "text-muted hover:bg-surface hover:text-ink",
            )}
          >
            {label}
          </Link>
        ))}
    </nav>
  );
}

export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visible = items.filter((i) => !i.adminOnly || isAdmin);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around">
        {visible.slice(0, 1).map(({ href, label, icon: Icon }) => (
          <NavLink key={href} href={href} label={label} active={isActive(pathname, href)} icon={<Icon className="size-5" />} />
        ))}
        <li className="flex items-center">
          <Link
            href="/leads/new"
            aria-label="New brief"
            className="-mt-5 grid size-12 place-items-center rounded-full bg-brand text-ink shadow-lg shadow-brand/30 transition active:scale-95"
          >
            <Plus className="size-6" aria-hidden />
          </Link>
        </li>
        {visible.slice(1).map(({ href, label, icon: Icon }) => (
          <NavLink key={href} href={href} label={label} active={isActive(pathname, href)} icon={<Icon className="size-5" />} />
        ))}
      </ul>
    </nav>
  );
}

function NavLink({ href, label, active, icon }: { href: string; label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <li className="flex-1">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={clsx(
          "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
          active ? "text-ink" : "text-muted",
        )}
      >
        <span className={clsx("grid h-6 w-10 place-items-center rounded-full transition", active && "bg-brand/25")}>{icon}</span>
        {label}
      </Link>
    </li>
  );
}
