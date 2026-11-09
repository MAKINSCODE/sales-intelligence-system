"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Copy, FileDown, Loader2, X } from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui";

// The thumbnail opens a larger view; Escape, the close button or a click outside closes it.
export function PhotoViewer({ src, name, className }: { src: string; name: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} aria-label={`View ${name}'s picture larger`} className="shrink-0 cursor-zoom-in rounded-2xl transition hover:opacity-90 active:scale-95">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, already-small, same-origin picture */}
        <img src={src} alt="" width={56} height={56} className={className} />
      </button>
      <dialog
        ref={dialog}
        aria-label={`${name}'s picture`}
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        className="m-auto max-h-[90dvh] max-w-[90vw] overflow-visible rounded-2xl bg-transparent p-0 backdrop:bg-black/70"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, same-origin picture */}
        <img src={src} alt={name} className="max-h-[80dvh] min-w-64 max-w-[85vw] rounded-2xl bg-white object-contain shadow-xl sm:min-w-96" />
        <button type="button" onClick={() => dialog.current?.close()} aria-label="Close picture" className="absolute -right-2 -top-2 grid size-9 place-items-center rounded-full bg-white shadow-md transition hover:bg-brand-soft">
          <X className="size-4" aria-hidden />
        </button>
      </dialog>
    </>
  );
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={clsx("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-medium transition hover:border-ink active:scale-95", className)}
    >
      {copied ? <Check className="size-3.5 text-brand-strong" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function Expandable({ items, visible, noun, plural }: { items: ReactNode[]; visible: number; noun: string; plural?: string }) {
  const [open, setOpen] = useState(false);
  const hidden = items.length - visible;
  if (hidden <= 0) return <>{items}</>;
  return (
    <>
      {open ? items : items.slice(0, visible)}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-1 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand-strong underline-offset-2 hover:underline"
      >
        <ChevronDown className={clsx("size-4 transition", open && "rotate-180")} aria-hidden />
        {open ? "Show fewer" : `Show ${hidden} more ${hidden === 1 ? noun : (plural ?? `${noun}s`)}`}
      </button>
    </>
  );
}

export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const targets = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => !!el);
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const first = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (first) setActive(first[0]);
      },
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [items]);

  return (
    <nav aria-label="Brief sections" className="sticky top-14 z-10 -mx-4 border-b border-line bg-white/95 px-4 backdrop-blur sm:-mx-6 sm:px-6">
      <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {items.map((i) => (
          <li key={i.id} className="shrink-0">
            <a
              href={`#${i.id}`}
              aria-current={active === i.id ? "location" : undefined}
              className={clsx("inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium transition", active === i.id ? "bg-ink text-white" : "text-muted hover:bg-surface hover:text-ink")}
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// The export is a server-side render plus a download, so a slow link gets generous time before it is given up on.
const PDF_TIMEOUT_MS = 90_000;

class ServerMessage extends Error {}

function pdfFailure(e: unknown) {
  if (e instanceof ServerMessage) return e.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You are offline. Reconnect and try again.";
  if (e instanceof DOMException && e.name === "AbortError") return "The PDF is taking too long. Check your connection and try again.";
  return "The PDF could not be downloaded. Check your connection and try again.";
}

export function ExportPdfButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [message, setMessage] = useState("");

  async function run() {
    setState("busy");
    setMessage("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/leads/${leadId}/pdf`, { cache: "no-store", signal: controller.signal });
      if (res.status === 401) return void router.push("/login");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ServerMessage(body?.error ?? "The PDF could not be created.");
      }
      const name = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name ? decodeURIComponent(name) : "brief.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState("idle");
    } catch (e) {
      setMessage(pdfFailure(e));
      setState("error");
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={run} disabled={state === "busy"} aria-busy={state === "busy"}>
        {state === "busy" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
        {state === "busy" ? "Preparing PDF" : "Export PDF"}
      </Button>
      {state === "error" && (
        <p role="alert" className="max-w-64 text-right text-xs text-[#b42318]">
          {message}
        </p>
      )}
    </div>
  );
}
