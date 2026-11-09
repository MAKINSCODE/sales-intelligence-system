"use client";

import { useActionState } from "react";
import { Upload } from "lucide-react";
import { Alert, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { importCatalogueAction, type ImportState } from "./catalogue-actions";

export function CatalogueImportForm() {
  const [state, action] = useActionState(importCatalogueAction, { status: "idle" } as ImportState);

  return (
    <form action={action} className="space-y-4">
      <Field label="Profile file" htmlFor="catalogue-file" hint="YAML, up to 1 MB. Must be marked approved.">
        <input
          id="catalogue-file"
          name="file"
          type="file"
          accept=".yaml,.yml,text/yaml"
          className="block w-full text-sm file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-ink file:px-4 file:text-sm file:font-semibold file:text-white hover:file:bg-[#262626]"
        />
      </Field>
      <Field label="Or paste the YAML" htmlFor="catalogue-text" optional>
        <Textarea id="catalogue-text" name="text" rows={4} className="font-mono text-xs" />
      </Field>
      <SubmitButton variant="dark" pendingLabel="Importing">
        <Upload className="size-4" aria-hidden /> Import profile
      </SubmitButton>

      {state.status === "ok" && <Alert tone="success">{state.message}</Alert>}
      {state.status === "error" && (
        <Alert tone="error">
          <ul className="list-disc space-y-1 pl-4">
            {state.errors?.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </Alert>
      )}
    </form>
  );
}
