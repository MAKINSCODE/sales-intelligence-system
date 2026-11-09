"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, MessageSquare, Send, X } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import type { ChatMessage, Proposal, RunView } from "@/lib/research/view";

const STARTERS = ["What are the strongest reasons to call now?", "Why is this the right angle?", "What should I avoid saying to them?"];


function Change({ p, pending, onApply, onDismiss }: { p: Proposal; pending: boolean; onApply: () => void; onDismiss: () => void }) {
  const [before, after] =
    p.kind === "rewrite_point" ? [p.before, [p.statement, p.insight, p.objection && `Likely pushback: ${p.objection}`].filter(Boolean).join("\n")]
    : [p.before.length ? p.before.map((g) => `- ${g}`).join("\n") : "(none)", p.gaps.length ? p.gaps.map((g) => `- ${g}`).join("\n") : "(none)"];
  return (
    <div className="mt-2 rounded-lg border border-brand/40 bg-brand-soft/40 p-3 text-sm" data-testid="chat-change" data-status={p.status}>
      <p className="font-medium">{p.summary}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium text-brand-strong">See the change</summary>
        <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Now</p>
        <p className="whitespace-pre-wrap text-muted line-through decoration-muted/50">{before}</p>
        <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Suggested</p>
        <p className="whitespace-pre-wrap">{after}</p>
      </details>
      {p.status === "pending" ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="dark" disabled={pending} onClick={onApply}><Check className="size-4" aria-hidden /> Apply</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={onDismiss}><X className="size-4" aria-hidden /> Dismiss</Button>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-muted">{p.status === "applied" ? "Applied to the brief" : "Dismissed"}</p>
      )}
    </div>
  );
}

function Message({ m, run, pending, onApply, onDismiss }: { m: ChatMessage; run: RunView; pending: boolean; onApply: (id: string) => void; onDismiss: (id: string) => void }) {
  const user = m.role === "USER";
  const cited = m.citations.map((id) => run.claims.find((c) => c.id === id)?.statement).filter((s): s is string => !!s);
  return (
    <li className={user ? "flex justify-end" : "flex"} data-testid={user ? "chat-user" : "chat-assistant"}>
      <div className={user ? "max-w-[90%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-white" : "max-w-[95%] rounded-2xl rounded-bl-md bg-surface px-3.5 py-2.5 text-sm"}>
        <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
        {cited.length > 0 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-xs font-medium text-brand-strong">Based on {cited.length} item{cited.length === 1 ? "" : "s"} in the brief</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted">{cited.map((s) => <li key={s}>{s.length > 160 ? `${s.slice(0, 160)}…` : s}</li>)}</ul>
          </details>
        )}
        {m.proposals.map((p) => <Change key={p.id} p={p} pending={pending} onApply={() => onApply(p.id)} onDismiss={() => onDismiss(p.id)} />)}
      </div>
    </li>
  );
}

const noop = () => () => {};

// A floating button opens a chat panel for follow-up questions and requests to change the call plan. Answers come from the evidence the brief holds.
export function BriefChat({ run, pending, onAsk, onSetFor, onApply, onDismiss }: { run: RunView; pending: boolean; onAsk: (text: string) => Promise<boolean>; onSetFor: (memberId: string) => Promise<boolean>; onApply: (messageId: string, proposalId: string) => void; onDismiss: (messageId: string, proposalId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);
  const count = run.messages.length;
  // Rendered into the body so the page's own animation cannot displace a fixed panel.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const waiting = run.messages.reduce((n, m) => n + m.proposals.filter((p) => p.status === "pending").length, 0);

  useEffect(() => {
    if (open && count > 0) end.current?.scrollIntoView({ block: "nearest" });
  }, [open, count, asking]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || asking) return;
    setAsking(true);
    try {
      if (await onAsk(q)) setDraft("");
    } finally {
      setAsking(false);
    }
  }

  async function switchTo(id: string) {
    if (switching || id === run.forMember?.id) return;
    setSwitching(id);
    try {
      await onSetFor(id);
    } finally {
      setSwitching(null);
    }
  }

  const asked = run.messages.some((m) => m.role === "USER");

  if (!mounted) return null;
  return createPortal(
    <>
      <section
        id="brief-chat-panel"
        hidden={!open}
        aria-label="Ask about this brief"
        data-testid="brief-chat"
        className="fixed inset-x-3 bottom-36 top-20 z-50 flex flex-col rounded-2xl border border-line bg-white p-4 shadow-2xl md:inset-x-auto md:bottom-24 md:right-6 md:top-auto md:h-[min(36rem,calc(100vh-8rem))] md:w-[26rem]"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold"><MessageSquare className="size-4 text-brand-strong" aria-hidden /> Ask about this brief</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">Answers use only what the brief found. Nothing changes until you apply it.</p>
          </div>
          <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"><X className="size-4" aria-hidden /></button>
        </div>

        {run.team.length > 0 && (
          <div className="mt-3" data-testid="brief-for">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">This brief is for</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Who this brief is for">
              {run.team.map((m) => {
                const on = run.forMember?.id === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={pending || asking || !!switching}
                    onClick={() => void switchTo(m.id)}
                    className={on ? "inline-flex min-h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-xs font-medium text-white" : "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-medium transition hover:border-ink disabled:opacity-50"}
                  >
                    {switching === m.id && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {!asked && !asking && (
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" disabled={asking || pending} onClick={() => void send(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-xs transition hover:border-ink disabled:opacity-50">{s}</button>
              ))}
            </div>
          )}
          <ul className="space-y-3" aria-live="polite">
            {run.messages.map((m) => <Message key={m.id} m={m} run={run} pending={pending || asking} onApply={(id) => onApply(m.id, id)} onDismiss={(id) => onDismiss(m.id, id)} />)}
            {asking && <li className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" aria-hidden /> Thinking</li>}
            <li ref={end} aria-hidden />
          </ul>
        </div>

        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <Textarea
            aria-label="Your question"
            rows={2}
            maxLength={1000}
            value={draft}
            placeholder="For example: why is this angle the right one?"
            className="min-w-0 flex-1 resize-none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
          />
          <Button type="submit" variant="dark" aria-label="Ask" disabled={asking || pending || !draft.trim()}>
            <Send className="size-4" aria-hidden />
          </Button>
        </form>
      </section>

      <button
        type="button"
        aria-expanded={open}
        aria-controls="brief-chat-panel"
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-20 right-4 z-50 inline-flex min-h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-semibold text-white shadow-lg transition hover:bg-[#262626] active:scale-95 md:bottom-6 md:right-6"
      >
        {open ? <X className="size-5" aria-hidden /> : <MessageSquare className="size-5" aria-hidden />}
        <span>{open ? "Close" : "Ask about this brief"}</span>
        {!open && waiting > 0 && <span className="grid size-5 place-items-center rounded-full bg-brand text-[11px] font-bold text-ink" title="Suggested changes waiting for you">{waiting}</span>}
      </button>
    </>,
    document.body,
  );
}
