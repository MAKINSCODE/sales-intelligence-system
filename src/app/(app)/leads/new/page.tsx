import type { Metadata } from "next";
import { LeadForm } from "./lead-form";

export const metadata: Metadata = { title: "New brief" };

export default function NewLeadPage() {
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">New brief</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        A name is enough to start. Add a company, title or link when you have them to avoid mistaken identity.
      </p>
      <div className="mt-8">
        <LeadForm />
      </div>
    </div>
  );
}
