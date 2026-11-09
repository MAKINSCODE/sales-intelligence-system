import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, decide, emailKind, matchKeywords, type Inputs } from "./rules";

const ok: Inputs = { email: "ceo@bigco.com", enquiryText: "We want to explore AI agents for operations.", intent: "business_enquiry", employees: 450, revenueUsdM: 300, exceptionSector: null };
const run = (over: Partial<Inputs> = {}, s = DEFAULT_SETTINGS) => decide({ ...ok, ...over }, s);
const outcome = (r: ReturnType<typeof run>, id: string) => r.rules.find((x) => x.id === id)!.outcome;

describe("emailKind", () => {
  it("separates personal, professional and unusable addresses", () => {
    expect(emailKind("a@gmail.com")).toBe("personal");
    expect(emailKind(" A@Outlook.com ")).toBe("personal");
    expect(emailKind("a@citybureau.example.gov")).toBe("professional");
    expect(emailKind("nope")).toBe("none");
    expect(emailKind(null)).toBe("none");
  });
});

describe("matchKeywords", () => {
  it("matches whole phrases regardless of case and punctuation", () => {
    expect(matchKeywords("Looking at Agentic AI, and ai-agents!", ["agentic ai", "ai agents"])).toEqual(["agentic ai", "ai agents"]);
    expect(matchKeywords("said maintain agents", ["ai agents"])).toEqual([]);
    expect(matchKeywords(null, ["ai agents"])).toEqual([]);
  });
});

describe("decide: disqualify", () => {
  it("disqualifies a personal email, however good the rest looks", () => {
    const r = run({ email: "me@gmail.com" });
    expect(r.decision).toBe("DISQUALIFIED");
    expect(r.reasons).toEqual(["Submitted with a personal email address."]);
  });
  it("disqualifies a request for a job or a personal agent", () => {
    expect(run({ intent: "job_seeking" }).decision).toBe("DISQUALIFIED");
    expect(run({ intent: "personal_agent" }).decision).toBe("DISQUALIFIED");
  });
  it("does not disqualify on what is merely unknown", () => {
    const r = run({ email: null, intent: null, enquiryText: null });
    expect(r.decision).toBe("NEEDS_REVIEW");
    expect(outcome(r, "email")).toBe("unknown");
  });
  it("disqualifies an enquiry that does not match what Acme does", () => {
    const r = run({ enquiryText: "Pricing please" });
    expect(r.decision).toBe("DISQUALIFIED");
    expect(r.reasons[0]).toContain("does not look like something Acme can help with");
  });
  it("disqualifies a company known to be below the size or revenue minimum", () => {
    const small = run({ employees: 5 });
    expect(small.decision).toBe("DISQUALIFIED");
    expect(small.reasons.join(" ")).toContain("About 5 employees, below the minimum of 100");
    expect(run({ revenueUsdM: 20 }).decision).toBe("DISQUALIFIED");
  });
  it("waives the size and revenue minimums for the professional-services exception", () => {
    expect(run({ employees: 5, revenueUsdM: 2, exceptionSector: "law firm" }).decision).toBe("QUALIFIED");
  });
});

describe("decide: qualify", () => {
  it("qualifies a professional email, target phrase, enough staff and revenue", () => {
    expect(run().decision).toBe("QUALIFIED");
  });
  it("uses the admin thresholds", () => {
    expect(run({}, { ...DEFAULT_SETTINGS, minEmployees: 500 }).decision).toBe("DISQUALIFIED");
    expect(run({ employees: 100, revenueUsdM: 100 }).decision).toBe("QUALIFIED");
    expect(run({ employees: 99 }).decision).toBe("DISQUALIFIED");
  });
  it("passes unknown revenue when the headcount passes", () => {
    const r = run({ revenueUsdM: null });
    expect(r.decision).toBe("QUALIFIED");
    expect(outcome(r, "revenue")).toBe("unknown");
  });
  it("qualifies a small firm through the professional-services exception, saying so", () => {
    const r = run({ employees: 8, revenueUsdM: null, exceptionSector: "law firm" });
    expect(r.decision).toBe("QUALIFIED");
    expect(r.reasons[0]).toContain("exception");
  });
  it("still needs the email and a matching enquiry when the exception applies", () => {
    expect(run({ exceptionSector: "law firm", enquiryText: "Tell me more" }).decision).toBe("DISQUALIFIED");
    expect(run({ exceptionSector: "law firm", email: null }).decision).toBe("NEEDS_REVIEW");
  });
});

describe("decide: needs review", () => {
  it("asks a person when the headcount is unknown", () => {
    const r = run({ employees: null });
    expect(r.decision).toBe("NEEDS_REVIEW");
    expect(r.reasons.join(" ")).toContain("headcount could not be found");
  });
  it("treats only a weaker phrase as unknown rather than a fail", () => {
    const r = run({ enquiryText: "We need AI automation for invoices." });
    expect(outcome(r, "keywords")).toBe("unknown");
    expect(r.decision).toBe("NEEDS_REVIEW");
    expect(outcome(run({ enquiryText: "Pricing please" }), "keywords")).toBe("fail");
  });
  it("judges on the company alone when there is no enquiry, but still asks when the company is unknown", () => {
    expect(run({ enquiryText: null, intent: null }).decision).toBe("QUALIFIED");
    expect(run({ enquiryText: null, intent: null, employees: null }).decision).toBe("NEEDS_REVIEW");
  });
  it("accepts a found employer in place of a missing work email", () => {
    expect(run({ email: null }).decision).toBe("NEEDS_REVIEW");
    const r = run({ email: null, workplaceVerified: true });
    expect(r.decision).toBe("QUALIFIED");
    expect(r.rules.find((x) => x.id === "email")?.detail).toContain("employer was found");
    expect(run({ email: "me@gmail.com", workplaceVerified: true }).decision).toBe("DISQUALIFIED");
  });
});
