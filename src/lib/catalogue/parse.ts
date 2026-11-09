import { createHash } from "node:crypto";
import { parse } from "yaml";
import { z } from "zod";

export type SolutionKind = "service" | "agent_case_study" | "accelerator";

export type Solution = {
  id: string;
  kind: SolutionKind;
  name: string;
  url?: string;
  summary: string;
  businessFunction?: string;
  // Figures are claims reported by the company, never independently verified.
  claims: string[];
};

export type CatalogueData = {
  company: { name: string; website?: string; tagline?: string; oneLine?: string };
  solutions: Solution[];
  excluded: { name: string; kind: SolutionKind; reason: string }[];
  handlingRules: string[];
  differentiators: string[];
};

export type CatalogueMeta = {
  approved: boolean;
  approvedBy: string | null;
  approvedOn: string | null;
  version: string;
  contentHash: string;
};

export type ParseResult =
  | { ok: true; meta: CatalogueMeta; data: CatalogueData; raw: unknown }
  | { ok: false; errors: string[] };

const text = z.string().trim().min(1);
const looseItem = z.looseObject({ name: z.string().optional(), status: z.string().optional() });

const root = z.looseObject({
  approved: z.boolean({ error: "`approved` must be true or false" }),
  approved_by: z.string().nullable().optional(),
  approved_on: z.union([z.string(), z.date()]).nullable().optional(),
  profile_version: z.union([z.string(), z.number()]).optional(),
  company: z.looseObject({ name: text }),
});

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function dig(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function collect(items: unknown, kind: SolutionKind, pick: (o: Record<string, unknown>) => Partial<Solution>, out: CatalogueData) {
  if (!Array.isArray(items)) return;
  for (const raw of items) {
    const parsed = looseItem.safeParse(raw);
    if (!parsed.success || !parsed.data.name) continue;
    const o = parsed.data as Record<string, unknown>;
    const name = parsed.data.name;
    if (parsed.data.status === "needs_owner_check") {
      out.excluded.push({ name, kind, reason: "Marked needs_owner_check in the profile" });
      continue;
    }
    const base = pick(o);
    out.solutions.push({
      id: str(o.id) ?? slug(name),
      kind,
      name,
      url: str(o.url),
      summary: base.summary ?? "",
      businessFunction: base.businessFunction,
      claims: base.claims ?? [],
    });
  }
}

export function parseCatalogue(source: string): ParseResult {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (e) {
    return { ok: false, errors: [`Not valid YAML: ${(e as Error).message.split("\n")[0]}`] };
  }

  const checked = root.safeParse(raw);
  if (!checked.success) {
    return {
      ok: false,
      errors: checked.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`),
    };
  }
  const doc = checked.data;

  const data: CatalogueData = {
    company: {
      name: doc.company.name,
      website: str(doc.company.website),
      tagline: str(dig(doc, "positioning", "tagline")),
      oneLine: str(dig(doc, "positioning", "one_line")),
    },
    solutions: [],
    excluded: [],
    handlingRules: asStrings(dig(doc, "owner_review", "handling_rules_for_agent")),
    differentiators: Array.isArray(doc.differentiators)
      ? doc.differentiators
          .map((d: Record<string, unknown>) => [str(d.claim), str(d.detail)].filter(Boolean).join(": "))
          .filter(Boolean)
      : [],
  };

  collect(dig(doc, "offerings", "services"), "service", (o) => ({ summary: str(o.description) }), data);
  collect(
    dig(doc, "agents", "case_study_agents"),
    "agent_case_study",
    (o) => ({ summary: str(o.what_it_does), businessFunction: str(o.function), claims: asStrings(o.results_claimed) }),
    data,
  );
  collect(
    dig(doc, "agents", "accelerators", "items"),
    "accelerator",
    (o) => ({ summary: str(o.does), claims: asStrings(o.claims) }),
    data,
  );

  if (data.solutions.length === 0) {
    return { ok: false, errors: ["No usable solutions were found (offerings.services, agents.case_study_agents or agents.accelerators.items)."] };
  }

  const approvedOn = doc.approved_on instanceof Date ? doc.approved_on.toISOString().slice(0, 10) : (doc.approved_on ?? null);
  return {
    ok: true,
    raw,
    data,
    meta: {
      approved: doc.approved,
      approvedBy: doc.approved_by ?? null,
      approvedOn,
      version: String(doc.profile_version ?? "unversioned"),
      contentHash: createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("hex"),
    },
  };
}
