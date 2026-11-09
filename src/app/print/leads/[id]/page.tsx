import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BriefDocument } from "@/components/brief/sections";
import { Logo } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { getActiveCatalogue } from "@/lib/catalogue/service";
import { loadRunView } from "@/lib/research/view";

export const metadata: Metadata = { title: "Meeting brief", robots: { index: false, follow: false } };

export default function PrintPage({ params }: PageProps<"/print/leads/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-muted">Preparing brief</p>}>
      <PrintBody params={params} />
    </Suspense>
  );
}

async function PrintBody({ params }: { params: PageProps<"/print/leads/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireUser();
  const [run, catalogue] = await Promise.all([loadRunView(id, user.id), getActiveCatalogue()]);
  if (!run || !run.brief || (run.status !== "COMPLETE" && run.status !== "PARTIAL")) notFound();

  const prepared = new Date(run.finishedAt ?? run.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main data-print-ready="true" className="mx-auto max-w-[760px] space-y-4 bg-white px-1 py-2 text-ink">
      <header className="flex items-end justify-between gap-4 border-b-2 border-brand pb-3">
        <div>
          <Logo />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Meeting brief</p>
        </div>
        <p className="text-right text-xs leading-relaxed text-muted">
          Prepared {prepared}
          <br />
          For internal preparation only
        </p>
      </header>

      {run.brief.partial.length > 0 && (
        <p className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          <span className="font-semibold text-ink">Incomplete brief.</span> {run.brief.partial.join(" ")}
        </p>
      )}

      <BriefDocument run={run} variant="print" hasCatalogue={!!catalogue} />

      <footer className="border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
        <p>
          <span className="font-semibold text-ink">How to read this brief.</span> Verified items are supported by the quoted passage from the numbered source. Collected items come from a third-party service and are not
          independently checked. Possible items are coincidences, not confirmed relationships. The angle and the reasons to call now are our reading of the evidence, not facts. Catalogue results are reported by the company and are not independently verified.
        </p>
      </footer>
    </main>
  );
}
