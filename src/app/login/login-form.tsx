"use client";

import { useActionState } from "react";
import { requestLogin, type LoginState } from "@/lib/auth/actions";
import { Alert, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

const initial: LoginState = { status: "idle" };

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action] = useActionState(requestLogin, initial);

  return (
    <div className="space-y-4">
      {expired && state.status === "idle" && (
        <Alert tone="error">That sign-in link is invalid or has expired. Request a new one below.</Alert>
      )}
      {state.status === "sent" ? (
        <div className="space-y-3">
          <Alert tone="success">
            <p className="font-medium">Check your email</p>
            <p className="mt-1 text-muted">{state.message} The link expires in 15 minutes.</p>
          </Alert>
          {state.devLink && (
            <Alert>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Development only</p>
              <a href={state.devLink} className="mt-1 block break-all text-brand-strong underline" data-testid="dev-link">
                Open sign-in link
              </a>
            </Alert>
          )}
        </div>
      ) : (
        <form action={action} className="space-y-4" noValidate>
          {state.status === "error" && <Alert tone="error">{state.message}</Alert>}
          <Field label="Work email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@company.com"
              required
              autoFocus
              aria-invalid={state.status === "error"}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Sending link">
            Email me a sign-in link
          </SubmitButton>
        </form>
      )}
    </div>
  );
}
