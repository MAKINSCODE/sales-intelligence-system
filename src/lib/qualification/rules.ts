import { GENERIC_MAIL_DOMAINS } from "@/lib/research/policy";

export type QualSettings = {
  minEmployees: number;
  minRevenueUsdM: number;
  strongKeywords: string[];
  weakKeywords: string[];
  exceptionSectors: string[];
};

export const DEFAULT_SETTINGS: QualSettings = {
  minEmployees: 100,
  minRevenueUsdM: 100,
  strongKeywords: ["agentic ai", "ai agents", "ai adoption", "fdes", "forward deployed engineers", "forward deployed engineer", "forward employed engineers", "ai staff augmentation"],
  weakKeywords: ["ai automation"],
  exceptionSectors: ["law firm", "M&A boutique", "private equity fund", "venture capital firm", "investment bank", "management consultancy"],
};

export type Intent = "business_enquiry" | "job_seeking" | "personal_agent" | "unclear";

export type RuleOutcome = "pass" | "fail" | "unknown";

export type Rule = {
  id: "email" | "job" | "personal_agent" | "keywords" | "size" | "revenue" | "sector";
  label: string;
  // A hard rule that fails disqualifies (size and revenue are waived for the professional-services exception).
  hard: boolean;
  outcome: RuleOutcome;
  detail: string;
};

export type Decision = "QUALIFIED" | "DISQUALIFIED" | "NEEDS_REVIEW";

export type Inputs = {
  email: string | null;
  enquiryText: string | null;
  intent: Intent | null;
  employees: number | null;
  revenueUsdM: number | null;
  exceptionSector: string | null;
  // True when public sources named the person's current employer, which stands in for a work email that was not given.
  workplaceVerified?: boolean;
};

export type Outcome = { decision: Decision; rules: Rule[]; reasons: string[] };

export function emailKind(email: string | null | undefined): "personal" | "professional" | "none" {
  const domain = email?.trim().toLowerCase().match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/)?.[1];
  if (!domain) return "none";
  return GENERIC_MAIL_DOMAINS.has(domain) ? "personal" : "professional";
}

// A trailing "s" is dropped from longer words so "AI agent" matches the phrase "ai agents".
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").map(stem).join(" ");

// Whole-phrase match, so "ai agents" is found in "Build AI agents." but "ai" alone never matches inside another word.
export function matchKeywords(text: string | null | undefined, keywords: string[]): string[] {
  const hay = ` ${norm(text ?? "")} `;
  return keywords.filter((k) => norm(k) && hay.includes(` ${norm(k)} `));
}

const n = (v: number) => v.toLocaleString("en-GB");

export function decide(input: Inputs, s: QualSettings): Outcome {
  const kind = emailKind(input.email);
  const strong = matchKeywords(input.enquiryText, s.strongKeywords);
  const weak = matchKeywords(input.enquiryText, s.weakKeywords);

  const rules: Rule[] = [
    {
      id: "email",
      label: "Professional email address",
      hard: true,
      outcome: kind === "professional" ? "pass" : kind === "personal" ? "fail" : input.workplaceVerified ? "pass" : "unknown",
      detail: kind === "professional" ? "Submitted with a work email address." : kind === "personal" ? "Submitted with a personal email address." : input.workplaceVerified ? "No email was given, but the person's employer was found in public sources." : "No usable email address was given.",
    },
    {
      id: "job",
      label: "Not a request for a job",
      hard: true,
      outcome: input.intent === "job_seeking" ? "fail" : input.intent ? "pass" : "unknown",
      detail: input.intent === "job_seeking" ? "The enquiry asks about a job." : input.intent ? "The enquiry is not asking for a job." : "There was no enquiry text to check.",
    },
    {
      id: "personal_agent",
      label: "Not asking for a personal agent",
      hard: true,
      outcome: input.intent === "personal_agent" ? "fail" : input.intent ? "pass" : "unknown",
      detail: input.intent === "personal_agent" ? "The enquiry asks for an agent for personal use." : input.intent ? "The enquiry is not about a personal agent." : "There was no enquiry text to check.",
    },
    {
      id: "keywords",
      label: "Enquiry matches what Acme does",
      hard: true,
      outcome: strong.length ? "pass" : weak.length || !input.enquiryText?.trim() ? "unknown" : "fail",
      detail: strong.length
        ? `Mentions: ${strong.join(", ")}.`
        : weak.length
          ? `Only a weaker term (${weak.join(", ")}); decide from the rest of the enquiry.`
          : input.enquiryText?.trim()
            ? "None of the target phrases appear in the enquiry."
            : "No enquiry was given, so the decision rests on the company.",
    },
    {
      id: "size",
      label: `At least ${n(s.minEmployees)} employees`,
      hard: true,
      outcome: input.employees === null ? "unknown" : input.employees >= s.minEmployees ? "pass" : "fail",
      detail: input.employees === null ? "The company's headcount could not be found." : input.employees >= s.minEmployees ? `About ${n(input.employees)} employees.` : `About ${n(input.employees)} employees, below the minimum of ${n(s.minEmployees)}.`,
    },
    {
      id: "revenue",
      label: `At least USD ${n(s.minRevenueUsdM)} million yearly revenue`,
      hard: true,
      outcome: input.revenueUsdM === null ? "unknown" : input.revenueUsdM >= s.minRevenueUsdM ? "pass" : "fail",
      detail:
        input.revenueUsdM !== null
          ? input.revenueUsdM >= s.minRevenueUsdM
            ? `About USD ${n(input.revenueUsdM)} million a year.`
            : `About USD ${n(input.revenueUsdM)} million a year, below the minimum of USD ${n(s.minRevenueUsdM)} million.`
          : input.employees !== null && input.employees >= s.minEmployees
            ? "Revenue could not be found in public sources. It is not held against the lead because the headcount meets the threshold."
            : "Revenue could not be found in public sources.",
    },
    {
      id: "sector",
      label: "Exception sector (professional services)",
      hard: false,
      outcome: input.exceptionSector ? "pass" : "unknown",
      detail: input.exceptionSector ? `Looks like a ${input.exceptionSector}. Profitability is not verified.` : "No exception sector was identified.",
    },
  ];

  const by = (id: Rule["id"]) => rules.find((r) => r.id === id)!;
  const exception = by("sector").outcome === "pass";
  const waived = (r: Rule) => exception && (r.id === "size" || r.id === "revenue");
  const hardFail = rules.filter((r) => r.hard && r.outcome === "fail" && !waived(r));
  if (hardFail.length) {
    // A missing target phrase adds nothing once a sharper reason (a job request, a personal email) is already given.
    const shown = hardFail.some((r) => r.id !== "keywords") ? hardFail.filter((r) => r.id !== "keywords") : hardFail;
    return { decision: "DISQUALIFIED", rules, reasons: shown.map((r) => (r.id === "keywords" ? `${r.detail} The enquiry does not look like something Acme can help with.` : r.detail)) };
  }

  // Unknown revenue is not held against a company whose headcount already qualifies it.
  const sizeOk = by("size").outcome === "pass" && by("revenue").outcome !== "fail";
  const noEnquiry = !input.enquiryText?.trim();
  if (by("email").outcome === "pass" && (by("keywords").outcome === "pass" || noEnquiry) && (sizeOk || exception)) {
    return { decision: "QUALIFIED", rules, reasons: [exception && !sizeOk ? "Qualifies through the professional-services exception." : noEnquiry ? "Meets the size criteria. No enquiry was given to check." : "Meets the size and enquiry criteria."] };
  }

  const gaps = rules.filter((r) => ["keywords", "size", "revenue"].includes(r.id) && r.outcome !== "pass" && !waived(r) && !(r.id === "revenue" && sizeOk) && !(r.id === "keywords" && noEnquiry));
  const missing = by("email").outcome !== "pass" ? [by("email")] : [];
  return { decision: "NEEDS_REVIEW", rules, reasons: [...missing, ...gaps].map((r) => `${r.label}: ${r.detail}`) };
}
