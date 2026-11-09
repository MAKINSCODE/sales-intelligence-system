"use client";

import { useActionState, useState, useTransition } from "react";
import { MailPlus, RotateCw, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { Alert, Badge, Button, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { LocalTime } from "@/components/local-time";
import {
  inviteUsers,
  resendInvite,
  restoreAccess,
  revokeAccess,
  setRole,
  type InviteState,
  type RowResult,
} from "./actions";

export function InviteForm() {
  const [state, action] = useActionState(inviteUsers, { status: "idle" } as InviteState);

  return (
    <form action={action} className="space-y-4" noValidate>
      <Field
        label="Email addresses"
        htmlFor="emails"
        hint="Paste one or many, separated by commas, spaces or new lines. Each person gets a link valid for 7 days."
      >
        <Textarea id="emails" name="emails" rows={3} placeholder="name@company.com, other@company.com" required />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <fieldset className="flex items-center gap-4 text-sm">
          <legend className="sr-only">Role</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="MEMBER" defaultChecked className="size-4 accent-[#2563eb]" /> Member
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="ADMIN" className="size-4 accent-[#2563eb]" /> Admin
          </label>
        </fieldset>
        <SubmitButton variant="dark" pendingLabel="Sending invitations">
          <MailPlus className="size-4" aria-hidden /> Send invitations
        </SubmitButton>
      </div>

      {state.status === "error" && <Alert tone="error">{state.message}</Alert>}
      {state.status === "done" && (
        <div className="space-y-2" data-testid="invite-result">
          {!!state.invited?.length && <Alert tone="success">Invited: {state.invited.join(", ")}</Alert>}
          {!!state.skipped?.length && <Alert>Already have access: {state.skipped.join(", ")}</Alert>}
          {!!state.invalid?.length && <Alert tone="error">Not valid email addresses: {state.invalid.join(", ")}</Alert>}
          {!!state.failed?.length && (
            <Alert tone="error">
              Created, but the email could not be sent to: {state.failed.join(", ")}. Use Resend once mail is working.
            </Alert>
          )}
          {state.devLinks?.map((l) => (
            <Alert key={l.email}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Development only</p>
              <p className="mt-1 text-sm font-medium">{l.email}</p>
              <a href={l.url} className="break-all text-brand-strong underline">{l.url}</a>
            </Alert>
          ))}
        </div>
      )}
    </form>
  );
}

export type MemberRow = {
  id: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  status: "INVITED" | "ACTIVE" | "REVOKED";
  lastLoginAt: string | null;
  isSelf: boolean;
};

const statusTone = { ACTIVE: "dark", INVITED: "brand", REVOKED: "danger" } as const;
const statusLabel = { ACTIVE: "Active", INVITED: "Invited", REVOKED: "Revoked" } as const;

export function MemberRowItem({ member }: { member: MemberRow }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const run = (fn: () => Promise<RowResult>, okText?: string) =>
    start(async () => {
      const res = await fn();
      setNote(res.error ? { tone: "error", text: res.error } : okText ? { tone: "ok", text: okText } : null);
    });

  return (
    <li className="py-4" data-testid={`member-${member.email}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <p className="truncate font-medium">
            {member.email}
            {member.isSelf && <span className="ml-2 text-xs font-normal text-muted">You</span>}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone[member.status]}>{statusLabel[member.status]}</Badge>
            {member.role === "ADMIN" && (
              <Badge tone="neutral">
                <ShieldCheck className="mr-1 size-3" aria-hidden /> Admin
              </Badge>
            )}
            <span className="text-xs text-muted">
              {member.lastLoginAt ? <>Last sign-in <LocalTime iso={member.lastLoginAt} /></> : "Has not signed in"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {member.status === "REVOKED" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => restoreAccess(member.id), "Access restored.")}>
              <UserPlus className="size-4" aria-hidden /> Restore
            </Button>
          ) : (
            <>
              {member.status === "INVITED" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resendInvite(member.id), "Invitation sent.")}>
                  <RotateCw className="size-4" aria-hidden /> Resend
                </Button>
              )}
              {!member.isSelf && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => setRole(member.id, member.role === "ADMIN" ? "MEMBER" : "ADMIN"))}
                >
                  {member.role === "ADMIN" ? "Make member" : "Make admin"}
                </Button>
              )}
              {!member.isSelf && (
                <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => revokeAccess(member.id))}>
                  <UserMinus className="size-4" aria-hidden /> Revoke
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {note && (
        <p role={note.tone === "error" ? "alert" : "status"} className={`mt-2 text-sm ${note.tone === "error" ? "text-[#b42318]" : "text-muted"}`}>
          {note.text}
        </p>
      )}
    </li>
  );
}
