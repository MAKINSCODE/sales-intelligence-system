import type { Metadata } from "next";
import { Suspense } from "react";
import { BadgeCheck } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { PageSkeleton } from "@/components/skeletons";
import { requireUser } from "@/lib/auth/session";
import { getActiveCatalogue } from "@/lib/catalogue/service";
import type { SolutionKind } from "@/lib/catalogue/parse";
import { listTeamProfiles } from "@/lib/team/service";
import { getSettings } from "@/lib/qualification/settings";
import { CatalogueImportForm } from "./catalogue-form";
import { QualificationForm } from "./qualification-form";
import { AddProfilesForm, AutoRefresh, RefreshAllButton, TeamProfileRow, type TeamRow } from "./team-section";

export const metadata: Metadata = { title: "Reference" };

const kindLabel: Record<SolutionKind, string> = {
  service: "Services",
  agent_case_study: "Agents delivered",
  accelerator: "Accelerators",
};

export default function ReferencePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Reference />
    </Suspense>
  );
}

async function Reference() {
  const user = await requireUser();
  const [catalogue, profiles, rules] = await Promise.all([getActiveCatalogue(), listTeamProfiles(), getSettings()]);
  const isAdmin = user.role === "ADMIN";
  const rows: TeamRow[] = profiles.map((p) => ({ id: p.id, url: p.linkedinUrl, name: p.fullName, headline: p.headline, status: p.status, error: p.error, lastRefreshedAt: p.lastRefreshedAt?.toISOString() ?? null }));
  const inProgress = profiles.some((p) => p.status === "PENDING" || p.status === "REFRESHING");

  return (
    <div className="animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Reference</h1>
      <p className="mt-1.5 text-[15px] text-muted">The team backgrounds leads are compared against, and the approved company profile.</p>

      <section aria-labelledby="team-heading" className="mt-8">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="team-heading" className="text-base font-semibold">Team LinkedIn profiles</h2>
            {isAdmin && rows.length > 0 && <RefreshAllButton disabled={inProgress} />}
          </div>
          <p className="mt-1 text-sm text-muted">
            Every brief, for anyone, looks for genuine common ground with these public profiles. They are re-read weekly, and whenever an admin asks.
          </p>
          <AutoRefresh active={inProgress} />

          {rows.length > 0 ? (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line px-4" data-testid="team-profile-list">
              {rows.map((r) => <TeamProfileRow key={r.id} row={r} isAdmin={isAdmin} />)}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted">No profiles yet, so briefs will not check for common ground.</p>
          )}

          {isAdmin && (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold">Add profiles</h3>
              <AddProfilesForm />
            </div>
          )}
        </Card>
      </section>

      <section aria-labelledby="qualification-heading" className="mt-6">
        <Card className="p-5">
          <h2 id="qualification-heading" className="text-base font-semibold">Qualification rules</h2>
          <p className="mt-1 text-sm text-muted">
            How briefs recommend qualify, disqualify or needs judgement. Personal email addresses, requests for a job and requests for a personal agent always disqualify.
          </p>
          {isAdmin ? (
            <div className="mt-4" data-testid="qualification-settings">
              <QualificationForm settings={rules} />
            </div>
          ) : (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2" data-testid="qualification-summary">
              <div><dt className="font-medium">Minimum employees</dt><dd className="text-muted">{rules.minEmployees.toLocaleString("en-GB")}</dd></div>
              <div><dt className="font-medium">Minimum yearly revenue</dt><dd className="text-muted">USD {rules.minRevenueUsdM.toLocaleString("en-GB")} million</dd></div>
              <div className="sm:col-span-2"><dt className="font-medium">Target phrases</dt><dd className="text-muted">{rules.strongKeywords.join(", ")}</dd></div>
              <div className="sm:col-span-2"><dt className="font-medium">Exception sectors</dt><dd className="text-muted">{rules.exceptionSectors.join(", ") || "None"}</dd></div>
            </dl>
          )}
        </Card>
      </section>

      <section aria-labelledby="company-heading" className="mt-6">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="company-heading" className="text-base font-semibold">Company profile and solutions</h2>
            {catalogue ? (
              <Badge tone="dark">
                <BadgeCheck className="mr-1 size-3.5" aria-hidden /> Approved
              </Badge>
            ) : (
              <Badge tone="brand">Not imported</Badge>
            )}
          </div>

          {catalogue ? (
            <div className="mt-4 space-y-5" data-testid="catalogue-summary">
              <p className="text-sm text-muted">
                Version {catalogue.version}, approved by {catalogue.approvedBy}
                {catalogue.approvedOn ? ` on ${catalogue.approvedOn}` : ""}. Results quoted from this profile are reported by the company, not
                independently verified.
              </p>
              {(Object.keys(kindLabel) as SolutionKind[]).map((kind) => {
                const items = catalogue.data.solutions.filter((s) => s.kind === kind);
                if (!items.length) return null;
                return (
                  <details key={kind} className="group rounded-lg border border-line open:bg-surface">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium">
                      {kindLabel[kind]}
                      <span className="text-muted">{items.length}</span>
                    </summary>
                    <ul className="divide-y divide-line border-t border-line">
                      {items.map((s) => (
                        <li key={s.id} className="px-4 py-3">
                          <p className="text-sm font-medium">{s.name}</p>
                          {s.summary && <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.summary}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
              {catalogue.data.excluded.length > 0 && (
                <div className="rounded-lg border border-line bg-brand-soft/50 px-4 py-3 text-sm">
                  <p className="font-medium">Held back until the owner confirms</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {catalogue.data.excluded.map((e) => <li key={e.name}>{e.name}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-relaxed text-muted">
              No approved profile is active. Briefs cannot recommend company solutions until an admin imports one.
            </p>
          )}

          {isAdmin && (
            <div className="mt-6 border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold">{catalogue ? "Replace with a new version" : "Import the approved profile"}</h3>
              <CatalogueImportForm />
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
