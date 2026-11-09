"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { quickBrief } from "@/app/(app)/leads/actions";
import clsx from "clsx";

const input =
  "min-h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-sm outline-none transition placeholder:text-muted focus:border-ink";

// A header button that opens a floating panel to filter the Briefs list by first and last name.
export function QuickSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const firstName = String(data.get("first") ?? "");
    const lastName = String(data.get("last") ?? "");
    setError(null);
    start(async () => {
      try {
        const res = await quickBrief(firstName, lastName);
        if (!res.ok) return setError(res.error);
        setOpen(false);
        router.push(`/leads/${res.id}`);
      } catch {
        setError(navigator.onLine ? "The search could not be run. Please try again." : "You are offline. Reconnect, then try again.");
      }
    });
  }

  return (
    // On phones the panel anchors to the (sticky) header and spans its width; from md up it drops from the button.
    <div ref={root} className="md:relative">
      <button
        type="button"
        aria-label="Quick brief search"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "grid size-9 place-items-center rounded-lg transition hover:bg-surface hover:text-ink",
          open ? "bg-surface text-ink" : "text-muted",
        )}
      >
        <Search className="size-4" aria-hidden />
      </button>

      {open && (
        <form
          id={panelId}
          role="search"
          aria-label="Quick brief search"
          onSubmit={submit}
          className="absolute inset-x-4 top-full z-30 mt-2 animate-fade-up rounded-xl border border-line bg-white p-4 shadow-xl sm:inset-x-6 md:inset-x-auto md:right-0 md:w-80"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">Quick brief search</p>
            <button type="button" aria-label="Close search" onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="space-y-2.5">
            <input ref={first} name="first" placeholder="First name" aria-label="First name" autoComplete="off" required disabled={pending} className={input} />
            <input name="last" placeholder="Last name" aria-label="Last name" autoComplete="off" required disabled={pending} className={input} />
          </div>
          <p className="mt-2.5 text-xs leading-relaxed text-muted">Opens their brief if you already have one. Otherwise the brief is generated now, without a review stop.</p>
          {error && <p role="alert" className="mt-2.5 text-xs font-medium text-[#b42318]">{error}</p>}
          <button type="submit" disabled={pending} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 text-sm font-medium text-white transition hover:opacity-90 active:scale-[0.99] disabled:opacity-70">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            {pending ? "Searching" : "Search"}
          </button>
        </form>
      )}
    </div>
  );
}
