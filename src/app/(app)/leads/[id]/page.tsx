import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui";
import { PageSkeleton } from "@/components/skeletons";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { fullName, leadStatusLabel, leadStatusTone } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { getActiveCatalogue } from "@/lib/catalogue/service";
import { loadRunView } from "@/lib/research/view";
import { BriefPanel } from "./brief-panel";
import { DeleteLead } from "./delete-lead";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage({ params }: PageProps<"/leads/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeadDetail params={params} />
    </Suspense>
  );
}

async function LeadDetail({ params }: { params: PageProps<"/leads/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireUser();
  const lead = await db.lead.findFirst({ where: { id, createdById: user.id } });
  if (!lead) notFound();
  const [run, members, catalogue] = await Promise.all([
    loadRunView(lead.id, user.id),
    db.teamProfile.findMany({ where: { lastRefreshedAt: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, fullName: true, linkedinUrl: true } }),
    getActiveCatalogue(),
  ]);
  const team = members.map((m) => ({ id: m.id, name: m.fullName ?? m.linkedinUrl }));
  const subtitle = [lead.jobTitle ?? run?.found.jobTitle, lead.company ?? run?.found.company].filter(Boolean).join(" at ");

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Briefs
        </Link>
        <DeleteLead leadId={lead.id} name={fullName(lead)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{fullName(lead)}</h1>
        <Badge tone={leadStatusTone[lead.status]}>{leadStatusLabel[lead.status]}</Badge>
      </div>
      {subtitle && <p className="mt-1.5 text-[15px]" data-testid="lead-subtitle">{subtitle}</p>}
      <p className="mt-1.5 text-sm text-muted">Added <LocalTime iso={lead.createdAt.toISOString()} /></p>

      <div className="mt-8">
        <BriefPanel
          lead={{ id: lead.id, firstName: lead.firstName, lastName: lead.lastName, company: lead.company, jobTitle: lead.jobTitle, country: lead.country, email: lead.email, profileUrl: lead.profileUrl, enquiryText: lead.enquiryText, notes: lead.notes }}
          initial={run}
          readiness={{ team: team.length, catalogue: !!catalogue }}
          team={team}
        />
      </div>
    </div>
  );
}
