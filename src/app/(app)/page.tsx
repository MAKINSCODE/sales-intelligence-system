import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Badge, Card, buttonClass } from "@/components/ui";
import { DecisionBadge } from "@/components/brief/sections";
import { PageSkeleton } from "@/components/skeletons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { fullName, leadPhotoUrl, leadStatusLabel, leadStatusTone } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { roleFromClaims } from "@/lib/research/view";

export default function BriefsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Briefs />
    </Suspense>
  );
}

async function Briefs() {
  const user = await requireUser();
  const leads = await db.lead.findMany({
    where: { createdById: user.id, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      photo: { select: { fetchedAt: true } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { decision: true, overrideDecision: true, claims: { where: { section: "WHO", hidden: false, detail: { path: ["group"], equals: "current" } }, select: { detail: true, hidden: true } } },
      },
    },
  });

  return (
    <div className="animate-fade-up">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Briefs</h1>
        <p className="mt-1.5 text-[15px] text-muted">Source-backed preparation for your next conversation.</p>
      </div>

      {leads.length === 0 ? (
        <Card className="mt-8 grid place-items-center px-6 py-16 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-brand-soft">
              <Plus className="size-5 text-brand-strong" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold">Start with a name</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Add a lead to prepare a brief. Company, title or a profile link help us confirm the right person.
            </p>
            <Link href="/leads/new" className={`${buttonClass({ variant: "dark" })} mt-6`}>
              Add your first lead
            </Link>
          </div>
        </Card>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
          {leads.map((lead) => {
            const found = roleFromClaims(lead.runs[0]?.claims ?? []);
            const subtitle = [lead.jobTitle ?? found.jobTitle, lead.company ?? found.company].filter(Boolean).join(" at ");
            return (
            <li key={lead.id}>
              <Link href={`/leads/${lead.id}`} className="group block">
                <Card className="flex items-center gap-4 p-4 transition group-hover:border-ink group-active:scale-[0.99]">
                  {lead.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a private, already-small, same-origin picture
                    <img src={leadPhotoUrl(lead.id, lead.photo.fetchedAt)} alt="" width={44} height={44} className="size-11 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand-strong" aria-hidden>
                      {lead.firstName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{fullName(lead)}</p>
                    <p className="truncate text-sm text-muted">
                      {subtitle || "No company or title yet"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={leadStatusTone[lead.status]}>{leadStatusLabel[lead.status]}</Badge>
                      {(lead.runs[0]?.overrideDecision ?? lead.runs[0]?.decision) && <DecisionBadge decision={(lead.runs[0].overrideDecision ?? lead.runs[0].decision)!} />}
                      <span className="text-xs text-muted"><LocalTime iso={lead.createdAt.toISOString()} /></span>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
                </Card>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
