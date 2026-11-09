"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, RefreshCw, RotateCcw, Sparkles, Star, Trash2, UserCheck, WifiOff, X } from "lucide-react";
import clsx from "clsx";
import { Alert, Badge, Button, Card, Textarea } from "@/components/ui";
import { BriefDocument, DecisionBadge, QualificationPanel } from "@/components/brief/sections";
import { EditingContext, type EditingApi } from "@/components/brief/editing";
import { ExportPdfButton } from "@/components/brief/interactive";
import { useRunPoll } from "@/components/brief/use-run-poll";
import { LocalTime } from "@/components/local-time";
import { runRef } from "@/lib/run-ref";
import type { RunView } from "@/lib/research/view";
import { BriefChat } from "./brief-chat";
import { LeadDetailsCard, type LeadFull } from "./lead-details";
import { applyBriefChange, approveLead, askBrief, chooseCandidate, deleteLeadBrief, dismissBriefChange, editBriefClaim, editBriefText, generateBrief, setBriefFor, proceedWithoutPerson, rejectLead, removeBriefClaim, restartBrief, revertBriefClaim, startAnyway, stopRun, submitRating } from "./research-actions";

const ACTIVE = new Set(["QUEUED", "QUALIFYING", "IDENTIFYING", "RESEARCHING", "WRITING"]);
const STEPS = [
  { key: "IDENTIFYING", label: "Find the right person" },
  { key: "QUALIFYING", label: "Check the company" },
  { key: "RESEARCHING", label: "Read sources" },
  { key: "WRITING", label: "Prepare the conversation" },
] as const;

const FOR_KEY = "brief-for";

// The last teammate chosen is remembered in this browser, so it is ready the next time.
function savedFor(team: { id: string }[]): string | null {
  try {
    const v = localStorage.getItem(FOR_KEY);
    return v && team.some((m) => m.id === v) ? v : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

function ForPicker({ team }: { team: { id: string; name: string }[] }) {
  // Rendered only in the browser, because the remembered choice lives there.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [value, setValue] = useState(() => savedFor(team) ?? "");
  if (!mounted) return <div className="mt-5 h-[4.5rem]" aria-hidden />;
  return (
    <label className="mt-5 block max-w-sm text-sm">
      <span className="mb-1 block font-medium">Who is this brief for?</span>
      <select
        id="brief-for"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          try {
            if (e.target.value) localStorage.setItem(FOR_KEY, e.target.value);
            else localStorage.removeItem(FOR_KEY);
          } catch {}
        }}
        className="min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm"
      >
        <option value="">Not sure yet</option>
        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <span className="mt-1 block text-xs text-muted">The fit and the angle are written for them. You can switch later from the chat.</span>
    </label>
  );
}

type Decision = "QUALIFIED" | "DISQUALIFIED" | "NEEDS_REVIEW";
type Readiness = { team: number; catalogue: boolean };

export function BriefPanel({ lead, initial, readiness, team }: { lead: LeadFull; initial: RunView | null; readiness: Readiness; team: { id: string; name: string }[] }) {
  const leadId = lead.id;
  const [run, setRun] = useState<RunView | null>(initial);
  // After an action the server sends a fresh copy, so the page is right even if the follow-up request is lost.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setRun(initial);
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const active = run ? ACTIVE.has(run.status) : false;
  const { connection, refresh } = useRunPoll({ leadId, active, onRun: setRun, onSignedOut: () => router.push("/login") });

  // The page header (lead status) is rendered on the server, so ask it to refresh when a run settles.
  const settled = run && !ACTIVE.has(run.status) ? `${run.id}:${run.status}` : null;
  const lastSettled = useRef(settled);
  useEffect(() => {
    if (settled && settled !== lastSettled.current) router.refresh();
    lastSettled.current = settled;
  }, [settled, router]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) setError(res.error ?? "Something went wrong.");
      } catch {
        // The request may have reached the server even though the reply did not come back, so the state is re-read below.
        setError(navigator.onLine ? "The request did not go through. Check your connection and try again. If this keeps happening, reload the page." : "You are offline. Reconnect and try again.");
      }
      await refresh(true);
    });

  // For changes the person makes to the finished brief: reports whether it went through, so an open editor can stay open when it did not.
  const [busy, setBusy] = useState(false);
  const perform = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusy(true);
    let ok = false;
    try {
      const res = await fn();
      ok = res.ok;
      if (!res.ok) setError(res.error ?? "Something went wrong.");
    } catch {
      setError(navigator.onLine ? "The request did not go through. Check your connection and try again." : "You are offline. Reconnect and try again.");
    }
    await refresh(true);
    setBusy(false);
    return ok;
  };

  const finished = !!run && (run.status === "COMPLETE" || run.status === "PARTIAL") && !!run.brief;
  const editing: EditingApi | null = finished
    ? {
        pending: pending || busy,
        editClaim: (id, text) => perform(() => editBriefClaim(leadId, id, text)),
        revertClaim: (id) => perform(() => revertBriefClaim(leadId, id)),
        removeClaim: (id, hidden) => perform(() => removeBriefClaim(leadId, id, hidden)),
        saveGaps: (list) => perform(() => editBriefText(leadId, run!.id, { gaps: list })),
      }
    : null;

  const shell = (main: React.ReactNode) => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="min-w-0 lg:col-span-2">{main}</div>
      <aside className="min-w-0 space-y-4" aria-label="Lead and recommendation">
        <LeadDetailsCard lead={lead} found={run?.found ?? null} hasBrief={finished} />
        {run && finished && (
          <BriefChat
            run={run}
            pending={pending || busy}
            onAsk={(text) => perform(() => askBrief(leadId, run.id, text))}
            onSetFor={(memberId) => perform(() => setBriefFor(leadId, run.id, memberId))}
            onApply={(m, p) => void perform(() => applyBriefChange(leadId, run.id, m, p))}
            onDismiss={(m, p) => void perform(() => dismissBriefChange(leadId, run.id, m, p))}
          />
        )}
      </aside>
    </div>
  );

  if (!run) {
    return shell(
      <Card className="p-5">
        <h2 className="text-base font-semibold">Brief</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Find the person first, then research them from public sources into a source-backed brief for your conversation. You will be asked to confirm who they are before anything is written.
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <Check2 ok={readiness.team > 0}>{readiness.team > 0 ? `${readiness.team} team LinkedIn profile${readiness.team === 1 ? "" : "s"} will be used to find your fit with them` : "No team profiles have been read yet, so your fit with them will not be checked"}</Check2>
          <Check2 ok={readiness.catalogue}>{readiness.catalogue ? "The approved company profile is available for solution suggestions" : "No approved company profile, so no solution will be suggested"}</Check2>
        </ul>
        {team.length > 0 && (
          <ForPicker team={team} />
        )}
        {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button disabled={pending} onClick={() => act(() => generateBrief(leadId, true, savedFor(team)))}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} Generate brief
          </Button>
          <Button variant="outline" disabled={pending} onClick={() => act(() => generateBrief(leadId, false, savedFor(team)))}>
            Review lead first
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted">Generate brief goes straight to the brief. Review lead first stops after the lead is checked against the qualification rules so you can decide whether to go on. The recommendation is shown beside the brief either way.</p>
      </Card>,
    );
  }

  return shell(
    <EditingContext.Provider value={editing}>
    <div className="space-y-4" data-testid="brief-panel" data-status={run.status}>
      {error && <Alert tone="error">{error}</Alert>}
      {connection !== "ok" && active && <ConnectionNotice offline={connection === "offline"} />}

      {!active && <RunTools run={run} pending={pending} onRestart={() => act(() => restartBrief(leadId))} onDelete={() => act(() => deleteLeadBrief(leadId))} />}

      {active && <Progress run={run} pending={pending} onStop={() => act(() => stopRun(leadId, run.id))} />}

      {run.status === "AWAITING_CONFIRMATION" && (
        <Confirmation run={run} pending={pending} onChoose={(id) => act(() => chooseCandidate(leadId, run.id, id))} onWithout={() => act(() => proceedWithoutPerson(leadId, run.id))} onStop={() => act(() => stopRun(leadId, run.id))} />
      )}

      {run.status === "AWAITING_APPROVAL" && run.decision && (
        <ReviewCard run={run} pending={pending} error={error} onProceed={() => act(() => approveLead(leadId, run.id))} onStop={() => act(() => rejectLead(leadId, run.id))} />
      )}

      {run.status === "SCREENED_OUT" && run.decision && (
        <Card className="p-5" data-testid="screened-out">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{run.stage?.startsWith("Rejected") ? "Rejected after review" : "Disqualified before research"}</h2>
            <DecisionBadge decision={run.stage?.startsWith("Rejected") ? (run.decision.system ?? "NEEDS_REVIEW") : "DISQUALIFIED"} />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {run.decision.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          {run.claims.some((c) => c.section === "QUALIFICATION") && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium underline-offset-2 hover:underline">See the checks</summary>
              <div className="mt-3"><QualificationPanel run={run} /></div>
            </details>
          )}
          <p className="mt-3 text-sm text-muted">Nothing further was researched. If you know better, you can research it anyway.</p>
          <Button className="mt-4" variant="dark" disabled={pending} onClick={() => act(() => startAnyway(leadId))}>
            <Sparkles className="size-4" aria-hidden /> Research anyway
          </Button>
        </Card>
      )}

      {(run.status === "FAILED" || run.status === "CANCELLED") && (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#b42318]" aria-hidden />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{run.status === "CANCELLED" ? "Research stopped" : "Research did not finish"}</h2>
              <p className="mt-1 text-sm text-muted">{run.error ?? "No brief was produced. Nothing has been invented to fill the gap."}</p>
              <p className="mt-1 text-xs text-muted">Reference {runRef(run.id)}</p>
              <Button className="mt-4" variant="dark" disabled={pending} onClick={() => act(() => generateBrief(leadId, false, savedFor(team)))}>
                <RefreshCw className="size-4" aria-hidden /> Try again
              </Button>
            </div>
          </div>
        </Card>
      )}

      {(run.status === "COMPLETE" || run.status === "PARTIAL") && run.brief && (
        <BriefView run={run} leadId={leadId} pending={pending} onRegenerate={() => act(() => generateBrief(leadId, false, savedFor(team)))} onRate={(r, n) => act(() => submitRating(leadId, run.id, r, n))} hasCatalogue={readiness.catalogue} />
      )}
    </div>
    </EditingContext.Provider>,
  );
}

const REVIEW_INTRO: Record<Decision, string> = {
  QUALIFIED: "The rules recommend going on: this lead meets the criteria.",
  NEEDS_REVIEW: "The rules could not settle this lead from what was found. It is your call.",
  DISQUALIFIED: "The rules recommend not going on. You can still choose to build the brief.",
};

// Every lead stops here after the person is identified and the company checked, so the person decides whether the full brief is worth building.
function ReviewCard({ run, pending, error, onProceed, onStop }: { run: RunView; pending: boolean; error: string | null; onProceed: () => void; onStop: () => void }) {
  const d = run.decision!;
  const system = d.system ?? "NEEDS_REVIEW";
  const who = run.claims.find((c) => c.section === "WHO" && c.detail?.group === "current")?.statement;
  const filled = [
    !run.lead.company && run.found.company && ["Company", run.found.company],
    !run.lead.jobTitle && run.found.jobTitle && ["Job title", run.found.jobTitle],
    !run.lead.country && run.found.country && ["Country", run.found.country],
    !run.lead.profileUrl && run.found.profileUrl && ["Profile link", run.found.profileUrl],
  ].filter((x): x is string[] => !!x);
  return (
    <Card className="p-5" data-testid="awaiting-approval">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">Review before the brief</h2>
        <span data-testid="review-status"><DecisionBadge decision={system} /></span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {who ? `Identified as ${who}. ` : ""}
        {REVIEW_INTRO[system]}
      </p>
      {filled.length > 0 && (
        <dl className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm" data-testid="found-online">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Filled in from public sources</dt>
          {filled.map(([label, value]) => (
            <dd key={label} className="mt-1.5 flex flex-wrap gap-x-2"><span className="text-muted">{label}:</span><span className="break-all font-medium">{value}</span></dd>
          ))}
        </dl>
      )}
      <details className="mt-4" open>
        <summary className="cursor-pointer text-sm font-medium underline-offset-2 hover:underline">The checks</summary>
        <div className="mt-3"><QualificationPanel run={run} /></div>
      </details>
      {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button variant="dark" disabled={pending} onClick={onProceed}>
          <Sparkles className="size-4" aria-hidden /> {system === "DISQUALIFIED" ? "Proceed anyway" : "Proceed to brief"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onStop}>
          <X className="size-4" aria-hidden /> Don&apos;t proceed
        </Button>
      </div>
    </Card>
  );
}

// Start over or remove the brief from any settled state; deleting asks twice because it cannot be undone.
function RunTools({ run, pending, onRestart, onDelete }: { run: RunView; pending: boolean; onRestart: () => void; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const finished = run.status === "COMPLETE" || run.status === "PARTIAL";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-testid="run-tools">
      {!finished && (
        <Button variant="outline" size="sm" disabled={pending} onClick={onRestart}>
          <RotateCcw className="size-4" aria-hidden /> Start over
        </Button>
      )}
      {confirming ? (
        <>
          <span className="text-sm text-muted">Delete this brief and its research?</span>
          <Button variant="dark" size="sm" disabled={pending} onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden /> Yes, delete
          </Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>Keep it</Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" aria-hidden /> Delete brief
        </Button>
      )}
    </div>
  );
}

function ConnectionNotice({ offline }: { offline: boolean }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-line bg-surface px-3.5 py-3 text-sm" data-testid="connection-notice">
      <WifiOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <p>
        <span className="font-medium">{offline ? "You are offline." : "Having trouble reaching the server."}</span>{" "}
        <span className="text-muted">The research keeps running. This page updates again as soon as the connection is back.</span>
      </p>
    </div>
  );
}

function Check2({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-brand-strong" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
      <span className={ok ? "" : "text-muted"}>{children}</span>
    </li>
  );
}

function Progress({ run, pending, onStop }: { run: RunView; pending: boolean; onStop: () => void }) {
  const current = run.status === "QUEUED" ? 0 : STEPS.findIndex((s) => s.key === run.status);
  const waiting = useWaitingTooLong(run.status === "QUEUED", run.id);
  return (
    <Card className="p-5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Researching</h2>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onStop}><X className="size-4" aria-hidden /> Stop</Button>
      </div>
      <ol className="mt-4 space-y-3">
        {STEPS.map((s, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm" data-state={state}>
              <span className={clsx("grid size-6 shrink-0 place-items-center rounded-full text-xs", state === "done" && "bg-ink text-white", state === "active" && "bg-brand text-ink", state === "todo" && "bg-surface text-muted ring-1 ring-line")}>
                {state === "done" ? <Check className="size-3.5" aria-hidden /> : state === "active" ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : i + 1}
              </span>
              <span className={clsx(state === "todo" && "text-muted", state === "active" && "font-medium")}>{s.label}</span>
            </li>
          );
        })}
      </ol>
      {run.stage && <p className="mt-4 text-sm text-muted">{run.stage}</p>}
      {waiting && <p className="mt-2 text-sm text-muted" data-testid="queue-slow">This is taking longer to start than usual. It will begin as soon as the research service is free. You can stop it and try again if it does not.</p>}
      <p className="mt-3 text-xs text-muted">
        {run.usage.searches}/{run.limits.searches} searches · {run.usage.pages}/{run.limits.pages} pages · {run.usage.seconds}s of {run.limits.seconds}s. Research stops at these limits.
      </p>
    </Card>
  );
}

// True once a run has sat in the queue for a while, which points at a busy or unavailable worker.
function useWaitingTooLong(queued: boolean, runId: string, afterMs = 45_000) {
  const [slow, setSlow] = useState<string | null>(null);
  useEffect(() => {
    if (!queued) return;
    const t = setTimeout(() => setSlow(runId), afterMs);
    return () => clearTimeout(t);
  }, [queued, runId, afterMs]);
  return queued && slow === runId;
}

const CONF = { STRONG: { label: "Strong match", tone: "dark" as const }, POSSIBLE: { label: "Possible match", tone: "brand" as const }, WEAK: { label: "Weak match", tone: "neutral" as const } };

function Confirmation({ run, pending, onChoose, onWithout, onStop }: { run: RunView; pending: boolean; onChoose: (id: string) => void; onWithout: () => void; onStop: () => void }) {
  const none = run.candidates.length === 0;
  const canGoOn = run.companyOnlyPossible;
  return (
    <Card className="p-5" data-testid="confirmation">
      <h2 className="text-base font-semibold">{none ? "We could not confirm who this is" : "Is this the right person?"}</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {run.stage ?? "Choose the right person so the brief is about them and not someone with the same name."}
      </p>

      <ul className="mt-4 space-y-3">
        {run.candidates.map((c) => (
          <li key={c.id} className="rounded-lg border border-line p-4" data-testid="candidate">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{c.name}</p>
                {c.headline && <p className="text-sm text-muted">{c.headline}</p>}
                {c.location && <p className="text-sm text-muted">{c.location}</p>}
              </div>
              <Badge tone={CONF[c.confidence].tone}>{CONF[c.confidence].label}</Badge>
            </div>
            {c.signals.length > 0 && <p className="mt-2 text-xs text-muted">Matches your details: {c.signals.join(", ")}</p>}
            {c.mismatches.length > 0 && <p className="mt-1 text-xs text-[#b42318]">Does not match: {c.mismatches.join("; ")}</p>}
            {c.quote && <blockquote className="mt-2 border-l-2 border-brand pl-3 text-sm">&ldquo;{c.quote}&rdquo;</blockquote>}
            {c.sources.length > 0 && (
              <p className="mt-2 break-words text-xs text-muted">
                Sources:{" "}
                {c.sources.map((s, i) => (
                  <span key={i}>{i > 0 && " · "}{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{s.title ?? s.url}</a> : s.title}</span>
                ))}
              </p>
            )}
            <Button className="mt-3" size="sm" disabled={pending} onClick={() => onChoose(c.id)}>
              <UserCheck className="size-4" aria-hidden /> This is them
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {canGoOn && (
          <Button variant="outline" disabled={pending} onClick={onWithout}>
            {none ? "Continue with company information only" : "None of these: continue with company information only"}
          </Button>
        )}
        <Button variant="ghost" disabled={pending} onClick={onStop}>Cancel</Button>
      </div>
      {!canGoOn && <p className="mt-3 text-xs text-muted">There is no company, work email or enquiry to research. Add one to this lead, then generate the brief again.</p>}
    </Card>
  );
}

function BriefView({ run, leadId, pending, onRegenerate, onRate, hasCatalogue }: { run: RunView; leadId: string; pending: boolean; onRegenerate: () => void; onRate: (r: number, note: string) => void; hasCatalogue: boolean }) {
  const b = run.brief!;

  return (
    <div className="space-y-4" data-testid="brief">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {run.status === "PARTIAL" && <Badge tone="brand">Partial brief</Badge>}
          {run.unidentified && <Badge tone="neutral">Company information only</Badge>}
          {run.finishedAt && <span>Prepared <LocalTime iso={run.finishedAt} variant="dateTime" /></span>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={onRegenerate}><RefreshCw className="size-4" aria-hidden /> Refresh research</Button>
          <ExportPdfButton leadId={leadId} />
        </div>
      </div>

      {(b.partial.length > 0 || b.droppedUnsupported > 0) && (
        <Alert>
          <p className="font-medium">Some parts are incomplete <span className="font-normal text-muted">(reference {runRef(run.id)})</span></p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {b.partial.map((p) => <li key={p}>{p}</li>)}
            {b.droppedUnsupported > 0 && <li>{b.droppedUnsupported} unsupported {b.droppedUnsupported === 1 ? "detail was" : "details were"} left out because the source did not back it up.</li>}
          </ul>
        </Alert>
      )}

      <BriefDocument run={run} hasCatalogue={hasCatalogue} />

      <Rating key={run.id} run={run} pending={pending} onRate={onRate} />
      <p className="text-center text-xs text-muted">
        {run.usage.searches} searches · {run.usage.pages} pages read · {run.usage.llmCalls} analysis steps · {run.usage.seconds}s
        {b.team.length > 0 ? ` · compared with ${b.team.length} team profile${b.team.length === 1 ? "" : "s"}` : ""}
        {b.catalogue ? ` · Company profile ${b.catalogue}` : ""}
      </p>
    </div>
  );
}

function Rating({ run, pending, onRate }: { run: RunView; pending: boolean; onRate: (r: number, note: string) => void }) {
  const [value, setValue] = useState(run.brief?.rating ?? 0);
  const [note, setNote] = useState(run.brief?.ratingNote ?? "");
  const saved = run.brief?.rating != null && run.brief.rating === value && (run.brief.ratingNote ?? "") === note;
  return (
    <Card className="p-5" data-testid="rating">
      <h2 className="text-base font-semibold">How useful was this brief?</h2>
      <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} onClick={() => setValue(n)} className="grid size-11 place-items-center rounded-lg transition hover:bg-surface">
            <Star className={clsx("size-6", n <= value ? "fill-brand text-brand" : "text-[#c9c6c3]")} aria-hidden />
          </button>
        ))}
        <span className="ml-2 text-sm text-muted">{value ? `${value}/5` : "Not rated"}</span>
      </div>
      <Textarea className="mt-3" rows={2} placeholder="What was missing, wrong or most useful? (optional)" aria-label="Rating note" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button className="mt-3" variant="dark" size="sm" disabled={pending || value === 0 || saved} onClick={() => onRate(value, note)}>
        {saved ? "Saved" : "Save rating"}
      </Button>
    </Card>
  );
}
