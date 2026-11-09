"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/local-time";
import { addTeamProfilesAction, refreshTeamProfileAction, removeTeamProfileAction, type AddState } from "./team-actions";

export type TeamRow = {
  id: string;
  url: string;
  name: string | null;
  headline: string | null;
  status: "PENDING" | "REFRESHING" | "READY" | "FAILED";
  error: string | null;
  lastRefreshedAt: string | null;
};

const slugOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

// The worker fetches profiles in the background, so the list re-reads itself while any are still being read.
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4_000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}

export function AddProfilesForm() {
  const [state, action] = useActionState(addTeamProfilesAction, { status: "idle" } as AddState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <Field label="LinkedIn profile addresses" htmlFor="team-urls" hint="One or many, separated by spaces or new lines. Details are read within a minute and used by the next brief.">
        <Textarea id="team-urls" name="urls" rows={3} placeholder="https://www.linkedin.com/in/name" required />
      </Field>
      <SubmitButton variant="dark" pendingLabel="Adding">
        <Plus className="size-4" aria-hidden /> Add to team
      </SubmitButton>
      {state.status === "error" && <Alert tone="error">{state.message}</Alert>}
      {state.status === "done" && (
        <div className="space-y-2" data-testid="team-add-result">
          {!!state.added && <Alert tone="success">Added {state.added}. Reading {state.added === 1 ? "it" : "them"} now.</Alert>}
          {!!state.existing && <Alert>Already on the team: {state.existing}.</Alert>}
          {state.message && <Alert tone="error">{state.message}</Alert>}
        </div>
      )}
      {!!state.invalid?.length && <Alert tone="error">Not LinkedIn profile addresses: {state.invalid.join(", ")}</Alert>}
    </form>
  );
}

const tone = { READY: "dark", PENDING: "brand", REFRESHING: "brand", FAILED: "danger" } as const;
const label = { READY: "Up to date", PENDING: "Queued", REFRESHING: "Reading", FAILED: "Failed" } as const;

export function TeamProfileRow({ row, isAdmin }: { row: TeamRow; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  const busy = row.status === "REFRESHING";
  const run = (fn: () => Promise<unknown>) => start(async () => void (await fn()));

  return (
    <li className="py-4" data-testid={`team-profile-${slugOf(row.url)}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <p className="truncate font-medium">{row.name ?? slugOf(row.url)}</p>
          {row.headline && <p className="truncate text-sm text-muted">{row.headline}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={tone[row.status]}>{label[row.status]}</Badge>
            <span className="text-xs text-muted">{row.lastRefreshedAt ? <>Read <LocalTime iso={row.lastRefreshedAt} variant="dateTime" /></> : "Not read yet"}</span>
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-strong underline underline-offset-2">
              LinkedIn <ExternalLink className="size-3" aria-hidden />
            </a>
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={pending || busy} onClick={() => run(() => refreshTeamProfileAction(row.id))}>
              <RefreshCw className="size-4" aria-hidden /> Refresh
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => removeTeamProfileAction(row.id))} aria-label={`Remove ${row.name ?? slugOf(row.url)}`}>
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          </div>
        )}
      </div>
      {row.status === "FAILED" && row.error && (
        <p role="alert" className="mt-2 text-sm text-[#b42318]">
          {row.error}
          {row.lastRefreshedAt ? " The last good copy is still used." : ""}
        </p>
      )}
    </li>
  );
}

export function RefreshAllButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending || disabled} onClick={() => start(async () => void (await refreshTeamProfileAction()))}>
      <RefreshCw className="size-4" aria-hidden /> Refresh all
    </Button>
  );
}
