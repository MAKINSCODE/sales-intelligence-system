import { Briefcase, Check, ExternalLink, GraduationCap, Handshake, Lightbulb, MapPin, MessageCircle, Minus, Newspaper, Quote, Repeat2, ThumbsUp, UserRound, Users, X } from "lucide-react";
import clsx from "clsx";
import { Badge } from "@/components/ui";
import { CopyButton, Expandable, PhotoViewer, SectionNav } from "@/components/brief/interactive";
import { ClaimTools, GapTools, RemovedItems } from "@/components/brief/editing";
import { buildSnapshot, careerWithoutDuplicates, formatDay, initials, numberSources, type NumberedSource } from "@/lib/research/present";
import type { ClaimView, RunView } from "@/lib/research/view";

export type Variant = "web" | "print";

const KIND = {
  FACT: { label: "Verified", tone: "dark" as const, hint: "Supported by a source we read" },
  COLLECTED: { label: "Collected", tone: "neutral" as const, hint: "Collected by a third-party service from the public post; not independently checked" },
  PROVIDED: { label: "Provided", tone: "neutral" as const, hint: "Stated by the lead or entered by you, not checked" },
  POTENTIAL: { label: "Possible", tone: "brand" as const, hint: "A coincidence worth mentioning, not a confirmed relationship" },
  HYPOTHESIS: { label: "Hypothesis", tone: "brand" as const, hint: "A suggestion based on the evidence, not a fact" },
  UNAVAILABLE: { label: "Not available", tone: "neutral" as const, hint: "Missing or could not be checked" },
};

export function KindBadge({ kind }: { kind: ClaimView["kind"] }) {
  const k = KIND[kind];
  return (
    <span title={k.hint}>
      <Badge tone={k.tone}>{k.label}</Badge>
    </span>
  );
}

const detailOf = (c: ClaimView) => (c.detail ?? {}) as Record<string, unknown>;
const when = (iso: string) => formatDay(iso) ?? iso;

type Ctx = { variant: Variant; numberOf: (c: ClaimView) => number | null };

function Cite({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <a href={`#src-${n}`} className="ml-1 align-super text-[10px] font-semibold text-brand-strong no-underline hover:underline" aria-label={`Source ${n}`}>
      [{n}]
    </a>
  );
}

function Evidence({ claim, ctx }: { claim: ClaimView; ctx: Ctx }) {
  if (!claim.quote && !claim.source) return null;
  const s = claim.source;
  const body = (
    <div className="space-y-1.5 rounded-lg border border-line bg-surface p-3">
      {claim.quote && <blockquote className="border-l-2 border-brand pl-3 text-sm leading-relaxed text-ink">&ldquo;{claim.quote}&rdquo;</blockquote>}
      {s && (
        <p className="break-words text-xs text-muted">
          {s.url ? (
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline underline-offset-2">
              {s.title || s.domain} <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : (
            s.title
          )}
          {s.domain ? ` · ${s.domain}` : ""}
          {` · ${s.publishedAt ? `published ${when(s.publishedAt)}` : "publication date not stated"} · read ${when(s.retrievedAt)}`}
        </p>
      )}
    </div>
  );
  if (ctx.variant === "print") return <div className="mt-1.5 text-[13px]">{body}</div>;
  return (
    <details className="mt-1.5 text-sm">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-strong underline-offset-2 hover:underline">Evidence</summary>
      <div className="mt-1.5">{body}</div>
    </details>
  );
}

function Fact({ claim, ctx, children, tools = true }: { claim: ClaimView; ctx: Ctx; children?: React.ReactNode; tools?: boolean }) {
  return (
    <li className="break-inside-avoid py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 basis-60 text-[15px] leading-relaxed">
          {claim.statement}
          <Cite n={ctx.numberOf(claim)} />
        </p>
        <KindBadge kind={claim.kind} />
      </div>
      {children}
      <Evidence claim={claim} ctx={ctx} />
      {tools && <ClaimTools claim={claim} />}
    </li>
  );
}

function Card({ id, icon, title, hint, children }: { id: string; icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-32 break-inside-avoid-page rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-strong" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="text-base font-semibold leading-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-snug text-muted">{hint}</p>}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface px-3.5 py-3 text-sm leading-relaxed text-muted">{children}</p>;
}

function Timeline({ items, ctx, empty }: { items: ClaimView[]; ctx: Ctx; empty?: string }) {
  if (items.length === 0) return empty ? <Empty>{empty}</Empty> : null;
  const rows = items.map((c) => (
    <li key={c.id} className="relative break-inside-avoid pb-4 pl-6 last:pb-0">
      <span className="absolute left-0 top-1.5 size-2.5 rounded-full border-2 border-brand bg-white" aria-hidden />
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 basis-56 text-[15px] leading-relaxed">
          {c.statement}
          <Cite n={ctx.numberOf(c)} />
        </p>
        <KindBadge kind={c.kind} />
      </div>
      <Evidence claim={c} ctx={ctx} />
      <ClaimTools claim={c} />
    </li>
  ));
  return (
    <ol className="relative ml-1 border-l border-line pl-0">
      {ctx.variant === "print" ? rows : <Expandable items={rows} visible={3} noun="entry" plural="entries" />}
    </ol>
  );
}

function DecisionMakersSection({ claims, ctx }: { claims: ClaimView[]; ctx: Ctx }) {
  if (claims.length === 0) return <Empty>No other senior people at this organisation could be found in public sources.</Empty>;
  return (
    <ul className="divide-y divide-line">
      {claims.map((c) => <Fact key={c.id} claim={c} ctx={ctx} />)}
    </ul>
  );
}

function WhoSection({ claims, ctx }: { claims: ClaimView[]; ctx: Ctx }) {
  const current = claims.find((c) => detailOf(c).group === "current");
  const place = claims.find((c) => detailOf(c).group === "location");
  const career = careerWithoutDuplicates(current, claims.filter((c) => detailOf(c).group === "career"));
  const education = claims.filter((c) => detailOf(c).group === "education");
  const unavailable = claims.filter((c) => c.kind === "UNAVAILABLE");
  const provided = claims.filter((c) => c.kind === "PROVIDED");
  const heads = [current, place].filter((c): c is ClaimView => !!c);

  return (
    <div className="space-y-5">
      {heads.length > 0 && <ul className="divide-y divide-line">{heads.map((c) => <Fact key={c.id} claim={c} ctx={ctx} />)}</ul>}
      {unavailable.map((c) => <Empty key={c.id}>{c.statement}</Empty>)}
      {career.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><Briefcase className="size-3.5" aria-hidden /> Career</h3>
          <Timeline items={career} ctx={ctx} />
        </div>
      )}
      {education.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><GraduationCap className="size-3.5" aria-hidden /> Education</h3>
          <Timeline items={education} ctx={ctx} />
        </div>
      )}
      {provided.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Provided with the lead</h3>
          <ul className="divide-y divide-line">{provided.map((c) => <Fact key={c.id} claim={c} ctx={ctx} />)}</ul>
        </div>
      )}
    </div>
  );
}

type FitGroup = { memberId: string; member: string; url: string | null; rank: number; links: ClaimView[]; topics: string[]; ties: { topic: string; leadQuote: string; memberQuote: string }[] };

// One group per teammate, holding only the specific ties found with them (a shared school, employer or place, or a specific professional focus).
function fitGroups(claims: ClaimView[]): FitGroup[] {
  const groups: FitGroup[] = [];
  for (const c of claims.filter((x) => x.kind === "POTENTIAL" && detailOf(x).commonGround !== true)) {
    const d = detailOf(c);
    const member = typeof d.member === "string" ? d.member : "Team member";
    const memberId = typeof d.memberId === "string" ? d.memberId : member;
    let g = groups.find((x) => x.memberId === memberId);
    if (!g) groups.push((g = { memberId, member, url: typeof d.memberUrl === "string" ? d.memberUrl : null, rank: typeof d.rank === "number" ? d.rank : groups.length + 1, links: [], topics: [], ties: [] }));
    if (d.summary === true) {
      const ties = (d.ties as { topic: string; leadQuote: string; memberQuote: string }[] | undefined) ?? [];
      g.ties.push(...ties);
      g.topics.push(...ties.map((t) => t.topic));
    } else g.links.push(c);
  }
  return groups.filter((g) => g.links.length + g.topics.length > 0).sort((a, b) => a.rank - b.rank);
}

type FitHighlight = { key: string; text: string; note: string | null };

const KIND_ORDER: Record<string, number> = { employer: 0, education: 1, place: 2 };

// The few strongest, most specific ties for the summary: shared employers and schools with the years, then a specific shared focus with the lead's own words, then places.
function topFit(claims: ClaimView[], forId: string | null, forName: string | null, max = 3): FitHighlight[] {
  const g = forId ? fitGroups(claims).find((x) => x.memberId === forId) : undefined;
  if (!g) return [];
  const you = (s: string) => (forName && s.startsWith(forName) ? `You${s.slice(forName.length)}` : s).replace(/\.$/, "");
  const links = g.links
    .map((c) => ({ c, d: detailOf(c) }))
    .sort((a, b) => (b.d.overlap === "overlapping" ? 1 : 0) - (a.d.overlap === "overlapping" ? 1 : 0) || (KIND_ORDER[String(a.d.kind)] ?? 3) - (KIND_ORDER[String(b.d.kind)] ?? 3));
  const strongLinks = links.filter((l) => l.d.kind !== "place");
  const placeLinks = links.filter((l) => l.d.kind === "place");
  const years = (d: Record<string, unknown>) => (typeof d.explanation === "string" ? d.explanation.replace(/^They: /, "Them: ").replace(forName ? `${forName}:` : " ", "You:").replace(/\s+/g, " ") : null);
  const focus = g.ties.map((t) => ({ key: `tie-${t.topic}`, text: `Shared focus: ${t.topic}`, note: `They wrote: “${t.leadQuote.length > 110 ? `${t.leadQuote.slice(0, 110)}…` : t.leadQuote}”` }));
  return [
    ...strongLinks.map((l) => ({ key: l.c.id, text: you(l.c.statement), note: years(l.d) })),
    ...focus,
    ...placeLinks.map((l) => ({ key: l.c.id, text: you(l.c.statement), note: years(l.d) })),
  ].slice(0, max);
}

function FitBullets({ g, max, ctx, tools = true }: { g: FitGroup; max: number; ctx: Ctx; tools?: boolean }) {
  const items = [
    ...g.links.map((c) => ({ key: c.id, text: c.statement, claim: c })),
    ...g.topics.map((t) => ({ key: `topic-${t}`, text: `Shared focus: ${t}`, claim: null as ClaimView | null })),
  ].slice(0, max);
  return (
    <ul className="space-y-1.5 text-[15px] leading-snug">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <span>{i.text.replace(/\.$/, "")}</span>
            {i.claim && <Cite n={ctx.numberOf(i.claim)} />}
            {i.claim && tools && <ClaimTools claim={i.claim} edit={false} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FitEvidence({ g, ctx }: { g: FitGroup; ctx: Ctx }) {
  if (g.ties.length === 0) return null;
  return (
    <details className="mt-2" open={ctx.variant === "print"}>
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-xs font-medium text-brand-strong underline-offset-2 hover:underline">What this is based on</summary>
      <ul className="mt-1 space-y-2">
        {g.ties.map((t) => (
          <li key={t.topic} className="rounded-lg border border-line bg-surface p-3 text-sm">
            <p className="font-medium">{t.topic}</p>
            <blockquote className="mt-1 border-l-2 border-brand pl-3 leading-relaxed"><span className="text-xs text-muted">They wrote: </span>&ldquo;{t.leadQuote}&rdquo;</blockquote>
            <blockquote className="mt-1 border-l-2 border-line pl-3 leading-relaxed"><span className="text-xs text-muted">{g.member}&apos;s profile: </span>&ldquo;{t.memberQuote}&rdquo;</blockquote>
          </li>
        ))}
      </ul>
    </details>
  );
}

// What the person the brief is for has in common with the lead. Empty when nothing specific was found, in which case the section is left out.
export function hasFit(claims: ClaimView[], forId: string | null) {
  return !!forId && fitGroups(claims).some((g) => g.memberId === forId);
}

function FitSection({ claims, forId, forName, ctx }: { claims: ClaimView[]; forId: string | null; forName: string | null; ctx: Ctx }) {
  if (!forId) return <Empty>Choose who this brief is for, using the chat button, and the fit with them will show here.</Empty>;
  const g = fitGroups(claims).find((x) => x.memberId === forId);
  if (!g) return null;
  return (
    <div data-testid="fit-with-you">
      {forName && <p className="mb-2 text-xs text-muted">Written for {forName}.</p>}
      <FitBullets g={g} max={5} ctx={ctx} />
      <FitEvidence g={g} ctx={ctx} />
    </div>
  );
}

// Lighter: the strongest one or two ties each of the other teammates has with the lead.
export function hasOtherSignals(claims: ClaimView[], forId: string | null) {
  return fitGroups(claims).some((g) => g.memberId !== forId);
}

function OtherSignalsSection({ claims, forId, ctx }: { claims: ClaimView[]; forId: string | null; ctx: Ctx }) {
  const others = fitGroups(claims).filter((g) => g.memberId !== forId);
  if (others.length === 0) return null;
  return (
    <ul className="divide-y divide-line" data-testid="other-signals">
      {others.map((g) => (
        <li key={g.memberId} className="break-inside-avoid py-3 first:pt-0 last:pb-0">
          <h3 className="mb-1.5 text-sm font-semibold">
            {g.url && ctx.variant === "web" ? <a href={g.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{g.member}</a> : g.member}
          </h3>
          <FitBullets g={g} max={2} ctx={ctx} />
        </li>
      ))}
    </ul>
  );
}

const DECISION = {
  QUALIFIED: { label: "Qualified", tone: "dark" as const },
  DISQUALIFIED: { label: "Disqualified", tone: "danger" as const },
  NEEDS_REVIEW: { label: "Needs your judgement", tone: "brand" as const },
};

export function DecisionBadge({ decision }: { decision: keyof typeof DECISION }) {
  return <Badge tone={DECISION[decision].tone}>{DECISION[decision].label}</Badge>;
}

const RULE_ICON = { pass: Check, fail: X, unknown: Minus } as const;

function QualificationSection({ run, ctx, controls, rail = false }: { run: RunView; ctx: Ctx; controls?: React.ReactNode; rail?: boolean }) {
  const d = run.decision;
  if (!d) return <Empty>No qualification was recorded for this brief. Refresh the research to add one.</Empty>;
  const claims = run.claims.filter((c) => c.section === "QUALIFICATION");
  const group = (g: string) => claims.filter((c) => detailOf(c).group === g);
  const groups = [
    { id: "contact", title: "The person", items: group("contact") },
    { id: "company", title: "The company", items: group("company") },
    { id: "hiring", title: "Hiring signals", items: group("hiring") },
    { id: "competitor", title: "Competitor movement", items: group("competitor") },
  ].filter((g) => g.items.length > 0);

  const evidence = groups.map((g) => (
    <div key={g.id}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.title}</h3>
      <ul className="divide-y divide-line">
        {g.items.map((c) => (c.kind === "UNAVAILABLE" ? <li key={c.id} className="py-2"><Empty>{c.statement}</Empty></li> : <Fact key={c.id} claim={c} ctx={ctx} tools={false} />))}
      </ul>
      {g.id === "competitor" && d.competitors.length > 0 && <p className="mt-1 text-xs text-muted">Peers considered, inferred from public sources: {d.competitors.join(", ")}.</p>}
    </div>
  ));

  return (
    <div className={rail ? "space-y-4" : "space-y-5"} data-testid="qualification">
      <div className="flex flex-wrap items-center gap-3">
        <span data-testid="decision-final"><DecisionBadge decision={d.final!} /></span>
        {d.override && (
          <span className="text-xs text-muted">
            Changed from <strong className="font-medium text-ink">{DECISION[d.system!].label}</strong> by a team member{d.override.note ? `: “${d.override.note}”` : ""}
          </span>
        )}
      </div>
      {d.reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed" data-testid="decision-reasons">
          {d.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      {d.screenedOnly && <Empty>Only the quick checks on the submission were done. Company size, hiring and competitors were not looked at.</Empty>}

      <ul className="divide-y divide-line rounded-xl border border-line" data-testid="qualification-rules">
        {d.rules.map((r) => {
          const Icon = RULE_ICON[r.outcome];
          return (
            <li key={r.id} className={clsx("flex items-start gap-3", rail ? "px-3 py-2" : "px-4 py-2.5")} data-outcome={r.outcome}>
              <Icon className={clsx("mt-0.5 size-4 shrink-0", r.outcome === "pass" ? "text-brand-strong" : r.outcome === "fail" ? "text-[#b42318]" : "text-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.label}{r.hard && <span className="ml-2 text-[11px] font-normal text-muted">disqualifies if it fails</span>}</p>
                <p className="text-sm text-muted">{r.detail}</p>
              </div>
              <span className="sr-only">{r.outcome === "pass" ? "Met" : r.outcome === "fail" ? "Not met" : "Unknown"}</span>
            </li>
          );
        })}
      </ul>

      {rail && evidence.length > 0 ? (
        <details className="rounded-xl border border-line p-3" data-testid="company-evidence">
          <summary className="cursor-pointer text-sm font-medium">Company evidence ({claims.filter((c) => c.kind !== "UNAVAILABLE").length})</summary>
          <div className="mt-3 space-y-4">{evidence}</div>
        </details>
      ) : (
        evidence
      )}
      {controls}
    </div>
  );
}

function NowSection({ claims, ctx }: { claims: ClaimView[]; ctx: Ctx }) {
  const news = claims.filter((c) => c.kind === "FACT");
  const provided = claims.filter((c) => c.kind === "PROVIDED");
  const missing = claims.filter((c) => c.kind === "UNAVAILABLE");
  return (
    <div className="space-y-4">
      {provided.map((c) => (
        <div key={c.id} className="break-inside-avoid rounded-xl border border-line bg-surface p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Quote className="size-3.5" aria-hidden /> {String(detailOf(c).label ?? "Stated by the lead")}</p>
            <KindBadge kind="PROVIDED" />
          </div>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{c.statement}</p>
          <ClaimTools claim={c} edit={false} />
        </div>
      ))}
      {news.length > 0 && (
        <ul className="divide-y divide-line">
          {news.map((c) => (
            <li key={c.id} className="break-inside-avoid py-3">
              <div className="flex gap-3">
                <span className="mt-0.5 w-24 shrink-0 text-xs font-semibold text-brand-strong">{c.eventDate ? formatDay(c.eventDate) : "Undated"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 basis-56 text-[15px] leading-relaxed">
                      {c.statement}
                      <Cite n={ctx.numberOf(c)} />
                    </p>
                    <KindBadge kind="FACT" />
                  </div>
                  <Evidence claim={c} ctx={ctx} />
                  <ClaimTools claim={c} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {missing.map((c) => <Empty key={c.id}>{c.statement}</Empty>)}
    </div>
  );
}

const n0 = (v: unknown) => (typeof v === "number" ? v : null);

function PostCard({ claim, ctx }: { claim: ClaimView; ctx: Ctx }) {
  const d = detailOf(claim);
  const topic = typeof d.topic === "string" ? d.topic : null;
  const stats: [React.ReactNode, number | null, string][] = [
    [<ThumbsUp key="l" className="size-3.5" aria-hidden />, n0(d.likes), "likes"],
    [<MessageCircle key="c" className="size-3.5" aria-hidden />, n0(d.comments), "comments"],
    [<Repeat2 key="s" className="size-3.5" aria-hidden />, n0(d.shares), "shares"],
  ];
  return (
    <li className="break-inside-avoid rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-brand-strong">{claim.eventDate ? formatDay(claim.eventDate) : "Date not stated"}</span>
          {topic && <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium ring-1 ring-line">{topic}</span>}
        </div>
        <KindBadge kind="COLLECTED" />
      </div>
      <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">
        {claim.statement}
        <Cite n={ctx.numberOf(claim)} />
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {stats.filter(([, v]) => v !== null).map(([icon, v, label]) => (
          <span key={label} className="inline-flex items-center gap-1" title={label}>{icon}{v}<span className="sr-only"> {label}</span></span>
        ))}
        {claim.source?.url && ctx.variant === "web" && (
          <a href={claim.source.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-8 items-center gap-1 font-medium text-ink underline underline-offset-2">
            Open post <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>
      <ClaimTools claim={claim} edit={false} />
    </li>
  );
}

function ActivitySection({ claims, coverage, ctx }: { claims: ClaimView[]; coverage: RunView["brief"] extends infer B ? (B extends { postsCoverage: infer P } ? P : never) : never; ctx: Ctx }) {
  const posts = claims.filter((c) => c.kind === "COLLECTED");
  const missing = claims.filter((c) => c.kind === "UNAVAILABLE");
  if (posts.length === 0) return <div className="space-y-2">{missing.map((c) => <Empty key={c.id}>{c.statement}</Empty>)}</div>;
  const cards = posts.map((c) => <PostCard key={c.id} claim={c} ctx={ctx} />);
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-muted">
        Collected by a third-party service from this person&apos;s public LinkedIn profile{coverage?.profile ? ` (${coverage.profile})` : ""}. Posts are shown as written and are not independently checked.
        {coverage && coverage.rejected > 0 ? ` ${coverage.rejected} item${coverage.rejected === 1 ? " was" : "s were"} discarded because ${coverage.rejected === 1 ? "it was" : "they were"} not original posts by this profile.` : ""}
      </p>
      <ul className="grid grid-cols-1 gap-3">{ctx.variant === "print" ? cards : <Expandable items={cards} visible={4} noun="post" />}</ul>
    </div>
  );
}

function planText(run: RunView, angle: ClaimView | undefined, triggers: ClaimView[]) {
  const b = run.brief;
  const a = angle && detailOf(angle);
  return [
    `Call plan for ${run.lead.name}`,
    angle ? `\nAngle:\n${angle.statement}${typeof a?.insight === "string" ? `\n${a.insight}` : ""}${typeof a?.objection === "string" ? `\nLikely pushback: ${a.objection}` : ""}` : "",
    triggers.length ? `\nWhy now:\n${triggers.map((h) => `- ${h.statement}${typeof detailOf(h).soWhat === "string" ? ` (${detailOf(h).soWhat})` : ""}`).join("\n")}` : "",
    b?.gaps.length ? `\nStill to find out:\n${b.gaps.map((g) => `- ${g}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

const TRIGGER = { stated: "Stated by the lead", observed: "Seen in the evidence", inferred: "Our reading" } as const;

function AngleCard({ claim, byId, ctx }: { claim: ClaimView; byId: Map<string, ClaimView>; ctx: Ctx }) {
  const d = detailOf(claim);
  const basis = ((d.basisClaimIds as string[] | undefined) ?? []).map((id) => byId.get(id)?.statement).filter((x): x is string => !!x);
  return (
    <div className="break-inside-avoid rounded-xl border border-brand/40 bg-brand-soft/50 p-4 sm:p-5" data-testid="angle">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-strong"><Lightbulb className="size-3.5" aria-hidden /> The angle</p>
        <KindBadge kind="HYPOTHESIS" />
      </div>
      <p className="mt-2 text-lg font-semibold leading-snug">{claim.statement}</p>
      <ClaimTools claim={claim} />
      {typeof d.insight === "string" && <p className="mt-2 text-[15px] leading-relaxed">{d.insight}</p>}
      {typeof d.solutionName === "string" && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm leading-relaxed">
          <span className="font-semibold">Jada fit: {d.solutionName}.</span> {typeof d.whyRelevant === "string" ? d.whyRelevant : ""}
        </p>
      )}
      {typeof d.objection === "string" && (
        <p className="mt-3 text-sm leading-relaxed"><span className="font-semibold">Likely pushback:</span> {d.objection}</p>
      )}
      {basis.length > 0 &&
        (ctx.variant === "print" ? (
          <p className="mt-2 text-xs text-muted">Based on: {basis.join("; ")}</p>
        ) : (
          <details className="mt-2">
            <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-xs font-medium text-brand-strong underline-offset-2 hover:underline">Based on</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">{basis.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        ))}
    </div>
  );
}

function ConversationSection({ run, claims, all, ctx, hasCatalogue }: { run: RunView; claims: ClaimView[]; all: ClaimView[]; ctx: Ctx; hasCatalogue: boolean }) {
  const byId = new Map(all.map((c) => [c.id, c]));
  const points = claims.filter((c) => c.kind === "HYPOTHESIS");
  const angle = points.find((c) => detailOf(c).role === "angle");
  const hyps = points.filter((c) => c !== angle);
  const b = run.brief!;
  return (
    <div className="space-y-5">
      {angle && <AngleCard claim={angle} byId={byId} ctx={ctx} />}

      {hyps.length === 0 && !angle ? (
        <Empty>No suggestions could be grounded in the evidence we found.</Empty>
      ) : (
        hyps.length > 0 && (
          <div className="break-inside-avoid">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Why now</h3>
            <ol className="mt-2 grid grid-cols-1 gap-3">
              {hyps.map((c, i) => {
                const d = detailOf(c);
                const basis = ((d.basisClaimIds as string[] | undefined) ?? []).map((id) => byId.get(id)?.statement).filter((x): x is string => !!x);
                const type = typeof d.type === "string" && d.type in TRIGGER ? (d.type as keyof typeof TRIGGER) : null;
                return (
                  <li key={c.id} className="break-inside-avoid rounded-xl border border-line p-4">
                    <div className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-ink" aria-hidden>{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 basis-56 text-[15px] font-medium leading-relaxed">{c.statement}</p>
                          {type && <Badge tone={type === "inferred" ? "brand" : "dark"}>{TRIGGER[type]}</Badge>}
                        </div>
                        <ClaimTools claim={c} />
                        {typeof d.soWhat === "string" && <p className="mt-1.5 text-[15px] leading-relaxed text-muted"><span className="font-medium text-ink">Why it matters:</span> {d.soWhat}</p>}
                        {typeof d.solutionName === "string" && (
                          <p className="mt-2 rounded-lg bg-brand-soft px-3 py-2 text-sm leading-relaxed">
                            <span className="font-semibold">Jada fit: {d.solutionName}.</span> {typeof d.whyRelevant === "string" ? d.whyRelevant : ""}
                          </p>
                        )}
                        {basis.length > 0 &&
                          (ctx.variant === "print" ? (
                            <p className="mt-1.5 text-xs text-muted">Based on: {basis.join("; ")}</p>
                          ) : (
                            <details className="mt-1.5">
                              <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-xs font-medium text-brand-strong underline-offset-2 hover:underline">Based on</summary>
                              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">{basis.map((x) => <li key={x}>{x}</li>)}</ul>
                            </details>
                          ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )
      )}
      {!hasCatalogue && <p className="text-sm text-muted">No approved Jada profile is active, so no solution is suggested.</p>}

      {b.gaps.length > 0 && (
        <div className="break-inside-avoid">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Still to find out</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-relaxed">{b.gaps.map((g, i) => <li key={g}>{g}<GapTools gaps={b.gaps} index={i} /></li>)}</ul>
        </div>
      )}
      {ctx.variant === "web" && <CopyButton text={planText(run, angle, hyps)} label="call plan" className="px-3" />}
    </div>
  );
}

function Snapshot({ run, ctx }: { run: RunView; ctx: Ctx }) {
  const s = buildSnapshot(run);
  const tile = (href: string, icon: React.ReactNode, title: string, body: React.ReactNode, sub?: string) => (
    <a key={title} href={ctx.variant === "web" ? href : undefined} className={clsx("group block break-inside-avoid rounded-xl border border-line bg-white p-3.5 transition", ctx.variant === "web" && "hover:border-ink")}>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{icon}{title}</p>
      <div className="mt-1.5 text-sm leading-snug">{body}</div>
      {sub && <p className="mt-1.5 text-xs text-brand-strong">{sub}</p>}
    </a>
  );
  const quiet = <span className="text-muted">Nothing found</span>;
  const fit = topFit(run.claims.filter((c) => c.section === "CONNECTIONS"), run.forMember?.id ?? null, run.forMember?.name ?? null);
  return (
    <section id="summary" aria-labelledby="summary-h" className="scroll-mt-32 break-inside-avoid rounded-2xl border border-line bg-gradient-to-br from-brand-soft/70 via-white to-white p-5 sm:p-6">
      <div className="flex items-center gap-4">
        {run.lead.photoUrl ? (
          ctx.variant === "web" ? (
            <PhotoViewer src={run.lead.photoUrl} name={s.name} className="size-14 rounded-2xl bg-brand object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a private, already-small, same-origin picture
            <img src={run.lead.photoUrl} alt="" width={56} height={56} className="size-14 shrink-0 rounded-2xl bg-brand object-cover" />
          )
        ) : (
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand text-xl font-bold text-ink" aria-hidden>{initials(s.name) || <UserRound className="size-6" />}</span>
        )}
        <div className="min-w-0">
          <h2 id="summary-h" className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{s.name}</h2>
          {s.role && <p className="mt-0.5 text-[15px] leading-snug">{s.role}</p>}
          {s.place && <p className="mt-1 flex items-center gap-1 text-sm text-muted"><MapPin className="size-3.5 shrink-0" aria-hidden />{s.place}</p>}
        </div>
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Your five-minute read</p>
      {fit.length > 0 && (
        <div className="mt-2" data-testid="fit-summary">
          {tile("#fit", <Handshake className="size-3.5" aria-hidden />, "Fit with you", (
            <ul className="space-y-2">
              {fit.map((f) => (
                <li key={f.key} className="flex gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{f.text}</span>
                    {f.note && <span className="mt-0.5 block text-xs leading-snug text-muted">{f.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tile("#now", <Newspaper className="size-3.5" aria-hidden />, "In the news", s.latestNews ? <>{s.latestNews.statement}</> : quiet, s.latestNews?.eventDate ? formatDay(s.latestNews.eventDate) ?? undefined : undefined)}
        {tile("#activity", <MessageCircle className="size-3.5" aria-hidden />, "Their feed", s.latestPost ? <span className="line-clamp-3">{s.latestPost.statement}</span> : quiet, s.latestPost?.eventDate ? formatDay(s.latestPost.eventDate) ?? undefined : undefined)}
      </div>

      {s.angle && (
        <a href={ctx.variant === "web" ? "#conversation" : undefined} className="mt-3 block break-inside-avoid rounded-xl bg-ink p-4 text-white">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/70"><Lightbulb className="size-3.5" aria-hidden /> Your angle</p>
          <p className="mt-1.5 text-[17px] font-semibold leading-snug">{s.angle.statement}</p>
          {typeof detailOf(s.angle).insight === "string" && <p className="mt-1.5 text-sm leading-relaxed text-white/80">{detailOf(s.angle).insight as string}</p>}
        </a>
      )}
    </section>
  );
}

function Sources({ sources }: { sources: NumberedSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section id="sources" aria-labelledby="sources-h" className="scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <h2 id="sources-h" className="text-base font-semibold">Sources</h2>
      <p className="mt-0.5 text-xs text-muted">Every Verified item is backed by a passage from one of these. Dates show when each was published and when we read it.</p>
      <ol className="mt-3 space-y-2.5">
        {sources.map((s) => (
          <li key={s.id} id={`src-${s.n}`} className="flex scroll-mt-32 gap-3 break-inside-avoid text-sm">
            <span className="w-7 shrink-0 font-semibold text-brand-strong">[{s.n}]</span>
            <div className="min-w-0 flex-1 break-words">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline underline-offset-2">{s.title}</a>
              ) : (
                <span className="font-medium">{s.title}</span>
              )}
              <p className="text-xs text-muted">
                {s.domain ? `${s.domain} · ` : ""}
                {s.publishedAt ? `published ${when(s.publishedAt)}` : "publication date not stated"} · read {when(s.retrievedAt)}
                {s.collected ? " · collected by a third party" : ""}
              </p>
              {s.url && <p className="break-all text-[11px] text-muted">{s.url}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// The company checks on their own, for the cards shown before any person-level research is done.
export function QualificationPanel({ run }: { run: RunView }) {
  return <QualificationSection run={run} ctx={{ variant: "web", numberOf: () => null }} />;
}

export function BriefDocument({ run: full, variant = "web", hasCatalogue }: { run: RunView; variant?: Variant; hasCatalogue: boolean }) {
  // Items the person removed are left out everywhere, including the summary and the source numbering.
  const removed = full.claims.filter((c) => c.hidden && c.section !== "QUALIFICATION");
  const run: RunView = { ...full, claims: full.claims.filter((c) => !c.hidden) };
  const { sources, numberOf } = numberSources(run.claims);
  const ctx: Ctx = { variant, numberOf };
  const by = (s: ClaimView["section"]) => run.claims.filter((c) => c.section === s);
  const b = run.brief!;

  const forId = run.forMember?.id ?? null;
  const makers = by("WHO").filter((c) => detailOf(c).group === "decision_maker");
  const links = by("CONNECTIONS");
  // A section with nothing meaningful to say is left out, not filled in.
  const askWho = !forId && run.team.length > 0 && variant === "web";
  const sections: { id: string; nav: string; icon: React.ReactNode; title: string; hint?: string; body: React.ReactNode }[] = [
    { id: "who", nav: "Who they are", icon: <UserRound className="size-5" />, title: "Who they are", body: <WhoSection claims={by("WHO")} ctx={ctx} /> },
    ...(makers.length > 0 ? [{ id: "decision-makers", nav: "Decision makers", icon: <Users className="size-5" />, title: "Decision makers", hint: "Other senior people at their organisation who may decide on or influence a purchase. Found in public sources, so check they are still in post.", body: <DecisionMakersSection claims={makers} ctx={ctx} /> }] : []),
    ...(hasFit(links, forId) || askWho ? [{ id: "fit", nav: "Fit with you", icon: <Handshake className="size-5" />, title: "Fit with you", hint: "What you have in common with them. Only specific ties are listed, and they are possible coincidences, not confirmed relationships.", body: <FitSection claims={links} forId={forId} forName={run.forMember?.name ?? null} ctx={ctx} /> }] : []),
    ...(hasOtherSignals(links, forId) ? [{ id: "other-signals", nav: "Other signals", icon: <Users className="size-5" />, title: "Other signals for cofounders", hint: "Lighter overlaps between this person and the rest of the team.", body: <OtherSignalsSection claims={links} forId={forId} ctx={ctx} /> }] : []),
    { id: "now", nav: "What matters now", icon: <Newspaper className="size-5" />, title: "What matters now", body: <NowSection claims={by("NOW")} ctx={ctx} /> },
    { id: "activity", nav: "LinkedIn", icon: <MessageCircle className="size-5" />, title: "Latest LinkedIn activity", body: <ActivitySection claims={by("ACTIVITY")} coverage={b.postsCoverage} ctx={ctx} /> },
    { id: "conversation", nav: "Conversation", icon: <Lightbulb className="size-5" />, title: "Call plan", hint: "The angle and the reasons to call now are our reading of the evidence, not facts about this person.", body: <ConversationSection run={run} claims={by("CONVERSATION")} all={run.claims} ctx={ctx} hasCatalogue={hasCatalogue} /> },
  ];
  const nav = [{ id: "summary", label: "Summary" }, ...sections.map((x) => ({ id: x.id, label: x.nav })), ...(sources.length ? [{ id: "sources", label: "Sources" }] : [])];

  return (
    <div className="space-y-4">
      {variant === "web" && <SectionNav items={nav} />}
      <Snapshot run={run} ctx={ctx} />
      {sections.map((x, i) => (
        <Card key={x.id} id={x.id} icon={x.icon} title={`${String.fromCharCode(65 + i)}. ${x.title}`} hint={x.hint}>{x.body}</Card>
      ))}
      <Sources sources={sources} />
      {variant === "web" && <RemovedItems claims={removed} />}
    </div>
  );
}
