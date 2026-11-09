import { describe, expect, it, vi } from "vitest";
import { apifyCompanyProvider, apifyJobsProvider, AI_ROLE, CollectorError, parseCompany, parseJobs } from "./apify-company";
import { promotionSignal } from "./company-intel";
import { rankMembers, type LeadPost, type Member } from "./team-links";
import type { ProfileFacts } from "./evidence";
import { emptyProfile, profileFormSchema } from "@/lib/team/profile";

describe("parseCompany", () => {
  it("maps the documented fields and keeps only LinkedIn addresses", () => {
    const c = parseCompany([{ name: "Netflix", linkedinUrl: "https://www.linkedin.com/company/netflix?trk=x", industries: ["Entertainment Providers"], employeeCount: 16985, employeeCountRange: { start: 10001 }, website: "https://netflix.com", tagline: "Entertainment", locations: [{ headquarter: false, parsed: { text: "London" } }, { headquarter: true, parsed: { text: "Los Gatos, CA" } }] }]);
    expect(c).toEqual({ name: "Netflix", linkedinUrl: "https://www.linkedin.com/company/netflix", industries: ["Entertainment Providers"], employees: 16985, employeeRange: "10001+", website: "https://netflix.com", description: "Entertainment", headquarters: "Los Gatos, CA" });
    expect(parseCompany([{ name: "X", linkedinUrl: "javascript:alert(1)" }])?.linkedinUrl).toBeNull();
  });
  it("never turns a range into an exact headcount, and tolerates nothing found", () => {
    expect(parseCompany([{ name: "Small", employeeCountRange: { start: 11, end: 50 } }])).toMatchObject({ employees: null, employeeRange: "11-50" });
    expect(parseCompany([{ name: "Emaar", industries: [{ id: "44", name: "Real Estate", title: "Real Estate" }, "Construction"] }])?.industries).toEqual(["Real Estate", "Construction"]);
    expect(parseCompany([])).toBeNull();
    expect(parseCompany("nope")).toBeNull();
    expect(parseCompany([{ nothing: true }])).toBeNull();
  });
});

describe("parseJobs and AI_ROLE", () => {
  it("keeps titled jobs and recognises AI-related roles by whole word", () => {
    const jobs = parseJobs([{ title: "Senior AI Engineer", linkedinUrl: "https://www.linkedin.com/jobs/view/1/", postedDate: "2026-09-20", location: { linkedinText: "Denver" }, company: { name: "City Bureau" } }, { title: "" }, "junk"]);
    expect(jobs).toEqual([{ title: "Senior AI Engineer", url: "https://www.linkedin.com/jobs/view/1/", postedAt: "2026-09-20", location: "Denver", company: "City Bureau" }]);
    for (const t of ["Machine Learning Lead", "LLM Engineer", "Data Scientist", "Head of Agentic Systems"]) expect(AI_ROLE.test(t)).toBe(true);
    for (const t of ["Accountant", "Maintenance Technician", "Said Manager", "Email Marketing"]) expect(AI_ROLE.test(t)).toBe(false);
  });
});

describe("collector providers", () => {
  it("look a company up by name or address and run one company lookup", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ name: "Netflix" }]), { status: 200 }));
    const p = apifyCompanyProvider("tok", fetchImpl as unknown as typeof fetch);
    await p.lookup({ name: "Netflix" });
    await p.lookup({ name: "Netflix", linkedinUrl: "https://www.linkedin.com/company/netflix" });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("harvestapi~linkedin-company/run-sync-get-dataset-items");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ searches: ["Netflix"] });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ companies: ["https://www.linkedin.com/company/netflix"] });
  });

  it("search AI jobs for one company, preferring its address, and hide response bodies on failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("secret", { status: 402 }));
    const p = apifyJobsProvider("tok", fetchImpl as unknown as typeof fetch);
    const err = await p.search({ companyName: "City Bureau", companyUrl: "https://www.linkedin.com/company/city-bureau", maxItems: 25 }).catch((e) => e);
    expect(err).toBeInstanceOf(CollectorError);
    expect(err.message).toBe("Collection failed (HTTP 402)");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body).toMatchObject({ company: ["https://www.linkedin.com/company/city-bureau"], maxItems: 25, postedLimit: "month" });
    expect(() => apifyJobsProvider("")).toThrow(/APIFY_TOKEN/);
  });
});

const q = { quote: "a verbatim passage", sourceId: "s1" };
const facts = (over: Partial<ProfileFacts>): ProfileFacts => ({ currentRole: null, location: null, education: [], employment: [], ...over });

describe("promotionSignal", () => {
  const now = new Date("2026-10-14");
  const cur = { title: "Director", organisation: "City Bureau", ...q };
  it("reports a recent change of title at the current organisation, with its evidence", () => {
    const s = promotionSignal(facts({ currentRole: cur, employment: [{ organisation: "City Bureau", title: "Manager", start: "2019", end: "2025-05", ...q }, { organisation: "City Bureau", title: "Director", start: "2025-06", end: "present", ...q }] }), now);
    expect(s).toMatchObject({ statement: "Moved from Manager to Director at City Bureau (from 2025-06)", quote: "a verbatim passage", sourceId: "s1" });
  });
  it("stays quiet for an old change, a single role, or another employer", () => {
    expect(promotionSignal(facts({ currentRole: cur, employment: [{ organisation: "City Bureau", title: "Manager", start: "2015", end: "2018", ...q }, { organisation: "City Bureau", title: "Director", start: "2018", end: "present", ...q }] }), now)).toBeNull();
    expect(promotionSignal(facts({ currentRole: cur, employment: [{ organisation: "City Bureau", title: "Director", start: "2025-06", end: "present", ...q }] }), now)).toBeNull();
    expect(promotionSignal(facts({ currentRole: cur, employment: [{ organisation: "Other", title: "Manager", start: "2025-01", end: "2025-05", ...q }, { organisation: "City Bureau", title: "Director", start: "2025-06", end: "present", ...q }] }), now)).toBeNull();
    expect(promotionSignal(facts({}), now)).toBeNull();
  });
});

const member = (name: string, over: Record<string, unknown> = {}): Member => ({ id: name, name, linkedinUrl: `https://www.linkedin.com/in/${name.toLowerCase().replace(/ /g, "-")}`, profile: profileFormSchema.parse({ ...emptyProfile(name), ...over }) });

describe("rankMembers", () => {
  const lead = facts({ education: [{ institution: "Westfield University", qualification: null, start: "2022", end: "2024", ...q }], employment: [{ organisation: "Apex Utilities", title: null, start: "2019", end: "2021", ...q }] });
  const posts: LeadPost[] = [{ sourceId: "p1", quote: "Excited about agentic AI in operations", text: "Excited about agentic AI in operations and what it means for utilities.", date: "2026-09-28" }];
  const team = [
    member("Alpha", { education: [{ institution: "Westfield University", start: "2021", end: "2025" }] }),
    member("Bravo", { employment: [{ organisation: "Apex Utilities", start: "2019", end: "2022", workMode: "unknown" }], headline: "Building agentic AI products" }),
    member("Charlie"),
    member("Delta", { homeBase: "Nowhere" }),
  ];

  it("counts every link, ranks members by strength and drops members with none", () => {
    const r = rankMembers(team, lead, posts, ["agentic ai"]);
    expect(r.teamSize).toBe(4);
    expect(r.membersWithLinks).toBe(2);
    expect(r.totalLinks).toBe(3);
    expect(r.ranked.map((m) => [m.member.name, m.score])).toEqual([["Bravo", 5], ["Alpha", 3]]);
    const interest = r.ranked[0].links.find((l) => l.kind === "interest")!;
    expect(interest).toMatchObject({ leadSourceId: "p1", leadQuote: "Excited about agentic AI in operations", title: "Bravo also works with agentic ai" });
  });

  it("shows at most five members, but still counts them all", () => {
    const many = Array.from({ length: 8 }, (_, i) => member(`M${i}`, { education: [{ institution: "Westfield University", start: "2021", end: "2025" }] }));
    const r = rankMembers(many, lead, [], []);
    expect(r.ranked).toHaveLength(5);
    expect(r.membersWithLinks).toBe(8);
    expect(r.totalLinks).toBe(8);
  });

  it("needs a lead post AND a member profile on the same theme for an interest link", () => {
    expect(rankMembers([member("Bravo", { headline: "Agentic AI" })], null, [], ["agentic ai"]).ranked).toHaveLength(0);
    expect(rankMembers([member("Charlie")], null, posts, ["agentic ai"]).ranked).toHaveLength(0);
  });
});
