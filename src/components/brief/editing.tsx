"use client";

import { createContext, useContext, useState } from "react";
import { Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button, Textarea } from "@/components/ui";
import type { ClaimView } from "@/lib/research/view";

// What the person can change in a finished brief. Each call resolves to whether it went through, so an editor stays open on a failure.
export type EditingApi = {
  pending: boolean;
  editClaim: (id: string, text: string) => Promise<boolean>;
  revertClaim: (id: string) => Promise<boolean>;
  removeClaim: (id: string, hidden: boolean) => Promise<boolean>;
  saveGaps: (list: string[]) => Promise<boolean>;
};

export const EditingContext = createContext<EditingApi | null>(null);

const tool = "inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted transition hover:bg-surface hover:text-ink disabled:opacity-50";

function Editor({ initial, label, rows = 3, onSave, onClose }: { initial: string; label: string; rows?: number; onSave: (text: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        const ok = await onSave(text).catch(() => false);
        setSaving(false);
        if (ok) onClose();
      }}
    >
      <Textarea aria-label={`Edit ${label}`} rows={rows} value={text} maxLength={1500} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="dark" disabled={saving || !text.trim()}>Save</Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

// Shown under any item of the brief: a note when it was changed, and the controls to change or remove it.
export function ClaimTools({ claim, edit = true, remove = true }: { claim: ClaimView; edit?: boolean; remove?: boolean }) {
  const api = useContext(EditingContext);
  const [editing, setEditing] = useState(false);
  if (!api && !claim.edited) return null;
  return (
    <div className="mt-1" data-testid="claim-tools">
      {claim.edited && (
        <p className="text-xs text-muted" data-testid="edited-note">
          <span className="font-medium text-brand-strong">Edited by you.</span>
          {api && claim.originalStatement ? ` Originally: “${claim.originalStatement}”` : ""}
        </p>
      )}
      {api && !editing && (
        <div className="-ml-1.5 flex flex-wrap items-center">
          {edit && <button type="button" className={tool} disabled={api.pending} onClick={() => setEditing(true)}><Pencil className="size-3" aria-hidden /> Edit</button>}
          {claim.edited && <button type="button" className={tool} disabled={api.pending} onClick={() => void api.revertClaim(claim.id)}><RotateCcw className="size-3" aria-hidden /> Restore original</button>}
          {remove && <button type="button" className={tool} disabled={api.pending} onClick={() => void api.removeClaim(claim.id, true)}><Trash2 className="size-3" aria-hidden /> Remove</button>}
        </div>
      )}
      {api && editing && <Editor initial={claim.statement} label="this item" onSave={(t) => api.editClaim(claim.id, t)} onClose={() => setEditing(false)} />}
    </div>
  );
}

// The opener, a question or a gap: text that lives with the brief rather than as an item of evidence.
export function TextTools({ label, value, onSave, onRemove, light }: { label: string; value: string; onSave: (text: string) => Promise<boolean>; onRemove?: () => Promise<boolean>; light?: boolean }) {
  const api = useContext(EditingContext);
  const [editing, setEditing] = useState(false);
  if (!api) return null;
  const style = light ? `${tool} !text-white/70 hover:!bg-white/10 hover:!text-white` : tool;
  if (editing) return <Editor initial={value} label={label} rows={2} onSave={onSave} onClose={() => setEditing(false)} />;
  return (
    <div className="-ml-1.5 flex flex-wrap items-center">
      <button type="button" className={style} aria-label={`Edit ${label}`} disabled={api.pending} onClick={() => setEditing(true)}><Pencil className="size-3" aria-hidden /> Edit</button>
      {onRemove && <button type="button" className={style} aria-label={`Remove ${label}`} disabled={api.pending} onClick={() => void onRemove()}><Trash2 className="size-3" aria-hidden /> Remove</button>}
    </div>
  );
}

export function GapTools({ gaps, index }: { gaps: string[]; index: number }) {
  const api = useContext(EditingContext);
  if (!api) return null;
  const replace = (g: string | null) => api.saveGaps(gaps.flatMap((x, i) => (i !== index ? [x] : g ? [g] : [])));
  return <TextTools label={`gap ${index + 1}`} value={gaps[index]} onSave={(t) => replace(t)} onRemove={() => replace(null)} />;
}

// Removed items stay recoverable, so taking something out is never a leap of faith.
export function RemovedItems({ claims }: { claims: ClaimView[] }) {
  const api = useContext(EditingContext);
  if (!api || claims.length === 0) return null;
  return (
    <details className="rounded-2xl border border-line bg-white p-4 text-sm" data-testid="removed-items">
      <summary className="cursor-pointer text-sm font-medium">Removed items ({claims.length})</summary>
      <ul className="mt-2 divide-y divide-line">
        {claims.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3 py-2">
            <p className="min-w-0 flex-1 break-words text-muted">{c.statement.length > 200 ? `${c.statement.slice(0, 200)}…` : c.statement}</p>
            <Button size="sm" variant="outline" disabled={api.pending} onClick={() => void api.removeClaim(c.id, false)}>Restore</Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
