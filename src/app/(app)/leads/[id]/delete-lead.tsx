"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteLeadAction } from "./research-actions";

// Deleting removes the lead and its brief for good, so it asks first.
export function DeleteLead({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      setError(null);
      try {
        const res = await deleteLeadAction(leadId);
        if (!res.ok) return setError(res.error);
        router.replace("/");
      } catch {
        setError(navigator.onLine ? "The lead could not be deleted. Please try again." : "You are offline. Reconnect, then try again.");
      }
    });

  if (!confirming) {
    return (
      <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 className="size-3.5" aria-hidden /> Delete lead
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label={`Delete ${name}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-[#b42318]/30 bg-[#fef3f2] px-3 py-2 text-sm">
      <span>Delete {name} and their brief? This cannot be undone.</span>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
      <Button size="sm" variant="danger" disabled={pending} onClick={remove}>
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />} Delete
      </Button>
      {error && <span role="alert" className="w-full text-xs font-medium text-[#b42318]">{error}</span>}
    </div>
  );
}
