import { describe, expect, it, vi } from "vitest";
import { buildIdentityQueries, resolveIdentity, type LeadInput } from "./identity";
import type { IdentityResult } from "./identity-schema";
import type { Providers, SearchHit } from "./types";

const lead = (over: Partial<LeadInput> = {}): LeadInput => ({
  firstName: "James",
  lastName: "Harrison",
  company: null,
  jobTitle: null,
  profileUrl: null,
  email: null,
  country: null,
  enquiryText: null,
  ...over,
});

const hit = (id: string, title: string, snippet: string, url = `https://example.org/${id}`): SearchHit => ({
  id,
  url,
  title,
  snippet,
  score: 0.5,
  publishedDate: null,
});

const cand = (over: Partial<IdentityResult["candidates"][number]> = {}): IdentityResult["candidates"][number] => ({
  name: "James Harrison",
  headline: null,
  location: null,
  matches: [],
  mismatches: [],
  sourceIds: ["a"],
  quote: null,
  ...over,
});

function setup(hits: SearchHit[], result: Partial<IdentityResult>) {
  const search = vi.fn().mockResolvedValue(hits);
  const structured = vi.fn().mockResolvedValue({
    value: { candidates: [], needsMoreInfo: false, note: null, ...result },
    inputTokens: 1,
    outputTokens: 1,
  });
  const providers: Providers = { search: { search, extract: vi.fn() }, llm: { structured } };
  return { providers, search, structured };
}

describe("resolveIdentity", () => {
  it("auto-selects a single candidate corroborated by company and email domain", async () => {
    const hits = [hit("a", "James Harrison - Chief Executive", "James Harrison leads City Bureau, citybureau.example.gov", "https://citybureau.example.gov/team")];
    const { providers } = setup(hits, { candidates: [cand({ headline: "Chief Executive, City Bureau", quote: "James Harrison leads City Bureau" })] });
    const out = await resolveIdentity(lead({ company: "City Bureau", email: "james.harrison@citybureau.example.gov" }), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates[0].confidence).toBe("STRONG");
    expect(out.candidates[0].signals).toEqual(expect.arrayContaining(["email domain", "company"]));
    expect(out.autoSelect).toBe(0);
    expect(out.candidates[0].quote).toBe("James Harrison leads City Bureau");
  });

  it("never auto-selects when several people share the name, and asks for confirmation", async () => {
    const hits = [hit("a", "James Harrison - Denver", "James Harrison, engineer in Denver"), hit("b", "James Harrison - London", "James Harrison, project manager in London")];
    const { providers } = setup(hits, {
      candidates: [cand({ sourceIds: ["a"], headline: "Engineer, Dubai" }), cand({ sourceIds: ["b"], headline: "Project manager, Cairo" })],
    });
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates).toHaveLength(2);
    expect(out.autoSelect).toBeNull();
  });

  it("does not auto-select a lone name-only match", async () => {
    const { providers } = setup([hit("a", "James Harrison", "James Harrison")], { candidates: [cand()] });
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates[0].confidence).toBe("WEAK");
    expect(out.autoSelect).toBeNull();
  });

  it("drops candidates that cite no real result or have a different name", async () => {
    const { providers } = setup([hit("a", "Someone", "text")], {
      candidates: [cand({ sourceIds: ["does-not-exist"] }), cand({ name: "Karim Harrison", sourceIds: ["a"] }), cand({ sourceIds: [] })],
    });
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates).toHaveLength(0);
  });

  it("discards a model quote that is not in the retrieved text", async () => {
    const { providers } = setup([hit("a", "James Harrison", "James Harrison is an engineer")], {
      candidates: [cand({ quote: "James Harrison founded a billion dollar company" })],
    });
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates[0].quote).toBeNull();
  });

  it("matches names regardless of diacritics and script variants of case", async () => {
    const { providers } = setup([hit("a", "Jāmes Hārrïson", "Jāmes Hārrïson, Denver")], { candidates: [cand({ name: "Jāmes Hārrïson" })] });
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates).toHaveLength(1);
  });

  it("lowers confidence when the source contradicts the lead's details", async () => {
    const hits = [hit("a", "James Harrison - Acme", "James Harrison works at Acme Corp in London")];
    const { providers } = setup(hits, { candidates: [cand({ mismatches: ["Lead says Denver, source says London"] })] });
    const out = await resolveIdentity(lead({ company: "Acme", country: "London" }), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates[0].confidence).toBe("POSSIBLE");
    expect(out.autoSelect).toBeNull();
  });

  it("an exact profile-link match is strong on its own", async () => {
    const hits = [hit("a", "James Harrison", "James Harrison", "https://www.linkedin.com/in/james-harrison-cb/")];
    const { providers } = setup(hits, { candidates: [cand()] });
    const out = await resolveIdentity(lead({ profileUrl: "https://linkedin.com/in/james-harrison-cb" }), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates[0].confidence).toBe("STRONG");
    expect(out.candidates[0].signals).toContain("profile link");
  });

  it("refuses a surname-less lead without spending any budget", async () => {
    const { providers, search, structured } = setup([], {});
    const out = await resolveIdentity(lead({ firstName: "Jamaica", lastName: null, email: "it@example-motors.com" }), providers);
    expect(out.kind).toBe("not_identifiable");
    expect(search).not.toHaveBeenCalled();
    expect(structured).not.toHaveBeenCalled();
  });

  it("returns an empty result without calling the model when nothing is found", async () => {
    const { providers, structured } = setup([], {});
    const out = await resolveIdentity(lead(), providers);
    if (out.kind !== "candidates") throw new Error("expected candidates");
    expect(out.candidates).toHaveLength(0);
    expect(structured).not.toHaveBeenCalled();
  });

  it("does not put the lead's free-text enquiry into search queries", () => {
    const q = buildIdentityQueries(lead({ enquiryText: "We need a confidential AI agent for our CEO", company: "Northwind Traders" }));
    expect(q.join(" ")).not.toContain("confidential");
    expect(q[0]).toContain("Northwind Traders");
  });

  it("limits and de-duplicates queries", () => {
    const q = buildIdentityQueries(lead({ company: "City Bureau", email: "a@citybureau.example.gov", profileUrl: "https://linkedin.com/in/h" }));
    expect(q.length).toBeLessThanOrEqual(3);
    expect(new Set(q).size).toBe(q.length);
  });
});
