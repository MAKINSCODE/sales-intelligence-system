"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { Alert, Field, Input, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import type { QualSettings } from "@/lib/qualification/rules";
import { saveQualificationAction, type SettingsState } from "./qualification-actions";

const lines = (a: string[]) => a.join("\n");

export function QualificationForm({ settings }: { settings: QualSettings }) {
  const [state, action] = useActionState(saveQualificationAction, { status: "idle" } as SettingsState);
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum employees" htmlFor="q-employees">
          <Input id="q-employees" name="minEmployees" type="number" inputMode="numeric" min={0} defaultValue={settings.minEmployees} />
        </Field>
        <Field label="Minimum yearly revenue (USD millions)" htmlFor="q-revenue">
          <Input id="q-revenue" name="minRevenueUsdM" type="number" inputMode="numeric" min={0} defaultValue={settings.minRevenueUsdM} />
        </Field>
      </div>
      <Field label="Target phrases" htmlFor="q-strong" hint="One per line. An enquiry that mentions any of these counts as a match.">
        <Textarea id="q-strong" name="strongKeywords" rows={5} defaultValue={lines(settings.strongKeywords)} />
      </Field>
      <Field label="Weaker phrases" htmlFor="q-weak" hint="One per line. These alone do not qualify a lead; they are flagged for judgement." optional>
        <Textarea id="q-weak" name="weakKeywords" rows={2} defaultValue={lines(settings.weakKeywords)} />
      </Field>
      <Field label="Exception sectors" htmlFor="q-sectors" hint="One per line. A company of this type can qualify without the size and revenue minimums." optional>
        <Textarea id="q-sectors" name="exceptionSectors" rows={4} defaultValue={lines(settings.exceptionSectors)} />
      </Field>
      <SubmitButton variant="dark" pendingLabel="Saving">
        <Save className="size-4" aria-hidden /> Save rules
      </SubmitButton>
      {state.status === "ok" && <Alert tone="success">{state.message}</Alert>}
      {state.status === "error" && (
        <Alert tone="error">
          <ul className="list-disc space-y-1 pl-4">{state.errors?.map((e) => <li key={e}>{e}</li>)}</ul>
        </Alert>
      )}
    </form>
  );
}
