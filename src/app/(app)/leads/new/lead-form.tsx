"use client";

import { useActionState } from "react";
import { createLead, type LeadFormState } from "@/app/(app)/leads/actions";
import { Alert, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

const initial: LeadFormState = {};

// If the request itself fails (a dropped connection), the typed values are kept instead of the form being lost.
async function submit(prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  try {
    return await createLead(prev, formData);
  } catch (e) {
    if (String((e as { digest?: unknown } | null)?.digest ?? "").startsWith("NEXT_REDIRECT")) throw e;
    const values = Object.fromEntries([...formData.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    return { values, message: navigator.onLine ? "The lead could not be saved. Check your connection and try again." : "You are offline. Reconnect, then press Save lead again." };
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-xs font-medium text-[#b42318]">
      {message}
    </p>
  ) : null;
}

export function LeadForm() {
  const [state, action] = useActionState(submit, initial);
  const v = state.values ?? {};
  const e = state.errors ?? {};

  return (
    <form action={action} className="space-y-6" noValidate>
      {state.message && <Alert tone="error">{state.message}</Alert>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName">
          <Input id="firstName" name="firstName" defaultValue={v.firstName} autoComplete="off" required autoFocus
            aria-invalid={!!e.firstName} aria-describedby="firstName-error" />
          <FieldError id="firstName-error" message={e.firstName} />
        </Field>
        <Field label="Surname" htmlFor="lastName">
          <Input id="lastName" name="lastName" defaultValue={v.lastName} autoComplete="off" required
            aria-invalid={!!e.lastName} aria-describedby="lastName-error" />
          <FieldError id="lastName-error" message={e.lastName} />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="company" optional>
          <Input id="company" name="company" defaultValue={v.company} autoComplete="off" />
        </Field>
        <Field label="Job title" htmlFor="jobTitle" optional>
          <Input id="jobTitle" name="jobTitle" defaultValue={v.jobTitle} autoComplete="off" />
        </Field>
      </div>

      <Field label="Profile link" htmlFor="profileUrl" optional hint="LinkedIn or company page. Used to confirm identity. A confirmed personal LinkedIn link also lets us collect their recent public posts.">
        <Input id="profileUrl" name="profileUrl" type="url" inputMode="url" defaultValue={v.profileUrl}
          placeholder="https://" aria-invalid={!!e.profileUrl} aria-describedby="profileUrl-error" />
        <FieldError id="profileUrl-error" message={e.profileUrl} />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" optional hint="Helps identify the organisation from the domain.">
          <Input id="email" name="email" type="email" inputMode="email" defaultValue={v.email}
            aria-invalid={!!e.email} aria-describedby="email-error" />
          <FieldError id="email-error" message={e.email} />
        </Field>
        <Field label="Country" htmlFor="country" optional>
          <Input id="country" name="country" defaultValue={v.country} autoComplete="off" />
        </Field>
      </div>

      <Field label="Enquiry or message" htmlFor="enquiryText" optional hint="Paste what the lead told us. It is treated as stated by them, not verified.">
        <Textarea id="enquiryText" name="enquiryText" rows={5} defaultValue={v.enquiryText} />
      </Field>

      <Field label="Notes" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" rows={3} defaultValue={v.notes} />
      </Field>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <SubmitButton pendingLabel="Saving" className="sm:min-w-40">
          Save lead
        </SubmitButton>
      </div>
    </form>
  );
}
