"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import type { LeadFieldErrors } from "@/lib/leads";
import type { FoundDetails } from "@/lib/research/view";
import { updateLeadDetails } from "./research-actions";

export type LeadFull = {
  id: string;
  firstName: string;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  country: string | null;
  email: string | null;
  profileUrl: string | null;
  enquiryText: string | null;
  notes: string | null;
};

function Detail({ label, found, children }: { label: string; found?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words text-[15px]">
        {children}
        {found && <span className="ml-2 whitespace-nowrap rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-strong" title="Not supplied with the lead; found in public sources">Found online</span>}
      </dd>
    </div>
  );
}

const FIELDS = ["firstName", "lastName", "company", "jobTitle", "profileUrl", "email", "country", "enquiryText", "notes"] as const;

// What was submitted, with anything public sources added beside it. Anything can be corrected here.
export function LeadDetailsCard({ lead, found, hasBrief }: { lead: LeadFull; found: FoundDetails | null; hasBrief: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<LeadFieldErrors>({});

  const profileLink = lead.profileUrl ?? found?.profileUrl ?? null;
  const start = () => {
    setSaved(false);
    setError(null);
    setErrors({});
    setEditing(true);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await updateLeadDetails(lead.id, Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? "")])));
      if (!res.ok) {
        setError(res.error);
        setErrors(res.errors ?? {});
        return;
      }
      setEditing(false);
      setSaved(true);
      router.refresh();
    } catch {
      setError(navigator.onLine ? "The details could not be saved. Check your connection and try again." : "You are offline. Reconnect and try again.");
    } finally {
      setSaving(false);
    }
  }

  const err = (f: keyof LeadFieldErrors) => (errors[f] ? <p className="text-xs font-medium text-[#b42318]">{errors[f]}</p> : null);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Lead details</h2>
        {editing ? <Badge>Editing</Badge> : (
          <Button variant="ghost" size="sm" onClick={start}><Pencil className="size-3.5" aria-hidden /> Edit</Button>
        )}
      </div>
      {saved && !editing && (
        <div className="mt-3"><Alert tone="success">Saved.{hasBrief ? " Refresh the research to use the changes in the brief." : ""}</Alert></div>
      )}

      {editing ? (
        <form className="mt-4 space-y-3" onSubmit={submit} noValidate data-testid="lead-edit">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" htmlFor="edit-firstName"><Input id="edit-firstName" name="firstName" defaultValue={lead.firstName} required aria-invalid={!!errors.firstName} />{err("firstName")}</Field>
            <Field label="Surname" htmlFor="edit-lastName"><Input id="edit-lastName" name="lastName" defaultValue={lead.lastName ?? ""} required aria-invalid={!!errors.lastName} />{err("lastName")}</Field>
          </div>
          <Field label="Company" htmlFor="edit-company"><Input id="edit-company" name="company" defaultValue={lead.company ?? found?.company ?? ""} />{err("company")}</Field>
          <Field label="Job title" htmlFor="edit-jobTitle"><Input id="edit-jobTitle" name="jobTitle" defaultValue={lead.jobTitle ?? found?.jobTitle ?? ""} />{err("jobTitle")}</Field>
          <Field label="Country" htmlFor="edit-country"><Input id="edit-country" name="country" defaultValue={lead.country ?? found?.country ?? ""} />{err("country")}</Field>
          <Field label="Email" htmlFor="edit-email"><Input id="edit-email" name="email" type="email" defaultValue={lead.email ?? ""} aria-invalid={!!errors.email} />{err("email")}</Field>
          <Field label="Profile link" htmlFor="edit-profileUrl"><Input id="edit-profileUrl" name="profileUrl" type="url" defaultValue={lead.profileUrl ?? found?.profileUrl ?? ""} placeholder="https://" aria-invalid={!!errors.profileUrl} />{err("profileUrl")}</Field>
          <Field label="Enquiry" htmlFor="edit-enquiryText"><Textarea id="edit-enquiryText" name="enquiryText" rows={4} defaultValue={lead.enquiryText ?? ""} />{err("enquiryText")}</Field>
          <Field label="Notes" htmlFor="edit-notes"><Textarea id="edit-notes" name="notes" rows={3} defaultValue={lead.notes ?? ""} />{err("notes")}</Field>
          <div className="flex gap-2">
            <Button type="submit" variant="dark" size="sm" disabled={saving}>{saving ? "Saving" : "Save details"}</Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <dl className="mt-4 space-y-4" data-testid="lead-details">
          <Detail label="Company" found={!lead.company && !!found?.company}>{lead.company ?? found?.company ?? "Not provided"}</Detail>
          <Detail label="Job title" found={!lead.jobTitle && !!found?.jobTitle}>{lead.jobTitle ?? found?.jobTitle ?? "Not provided"}</Detail>
          <Detail label="Country" found={!lead.country && !!found?.country}>{lead.country ?? found?.country ?? "Not provided"}</Detail>
          <Detail label="Email">{lead.email ?? "Not provided"}</Detail>
          <Detail label="Profile link" found={!lead.profileUrl && !!found?.profileUrl}>
            {profileLink ? (
              <a href={profileLink} target="_blank" rel="noopener noreferrer" className="break-all text-brand-strong underline underline-offset-2">
                {profileLink}
              </a>
            ) : (
              "Not provided"
            )}
          </Detail>
          {lead.enquiryText && <Detail label="Enquiry"><span className="whitespace-pre-wrap">{lead.enquiryText}</span></Detail>}
          {lead.notes && <Detail label="Notes"><span className="whitespace-pre-wrap">{lead.notes}</span></Detail>}
        </dl>
      )}
    </Card>
  );
}
