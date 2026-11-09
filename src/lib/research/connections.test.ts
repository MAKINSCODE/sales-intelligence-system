import { describe, expect, it } from "vitest";
import { findConnections, periodOverlap, referencePlaces, sameName } from "./connections";
import type { ProfileFacts } from "./evidence";
import { emptyProfile, profileFormSchema, type ProfileForm } from "@/lib/team/profile";

const q = { quote: "a verbatim passage", sourceId: "s1" };
const noFacts: ProfileFacts = { currentRole: null, location: null, education: [], employment: [] };

const ref: ProfileForm = profileFormSchema.parse({
  ...emptyProfile("Alex Johnson"),
  homeBase: "Denver, CO, US",
  education: [{ institution: "Westfield University", start: "2021", end: "2025", location: "Springfield, OH" }],
  employment: [
    { organisation: "Apex Technologies", start: "2017-11", end: "2020-05", workMode: "hybrid", location: "Chicago, IL" },
    { organisation: "DataPulse", start: "2025-12", end: "2026-04", workMode: "remote", location: "UK" },
  ],
});

describe("sameName", () => {
  it("matches reordered and decorated names but not different institutions", () => {
    expect(sameName("Westfield University", "University of Westfield")).toBe(true);
    expect(sameName("Apex Technologies Ltd", "Apex Technologies")).toBe(true);
    expect(sameName("Denver State University", "Westfield University")).toBe(false);
    expect(sameName("Müller GmbH", "Muller")).toBe(true);
    expect(sameName("", "Westfield")).toBe(false);
  });
});

describe("periodOverlap", () => {
  it("detects overlap and non-overlap", () => {
    expect(periodOverlap({ start: "2019", end: "2022" }, { start: "2021", end: "2025" })).toBe("overlapping");
    expect(periodOverlap({ start: "2010", end: "2014" }, { start: "2021", end: "2025" })).toBe("not_overlapping");
    expect(periodOverlap({ start: "2017-11", end: "2020-05" }, { start: "2020-06", end: "2021-01" })).toBe("not_overlapping");
  });
  it("is unknown when dates are missing, never assumed", () => {
    expect(periodOverlap({ start: null, end: null }, { start: "2021", end: "2025" })).toBe("unknown");
    expect(periodOverlap({ start: "2020", end: null }, { start: "2021", end: "2025" })).toBe("unknown");
  });
  it("treats present as ongoing", () => {
    expect(periodOverlap({ start: "2024", end: "present" }, { start: "2025", end: "2026" })).toBe("overlapping");
  });
});

describe("findConnections", () => {
  it("finds a shared school with overlapping dates and keeps the lead's evidence", () => {
    const lead: ProfileFacts = { ...noFacts, education: [{ institution: "University of Westfield", qualification: null, start: "2022", end: "2024", ...q }] };
    const [c] = findConnections(ref, lead);
    expect(c).toMatchObject({ kind: "education", overlap: "overlapping", leadSourceId: "s1", leadQuote: "a verbatim passage" });
    expect(c.title).toContain("Westfield University");
    expect(c.detail).toContain("may have been there at the same time");
  });

  it("states that missing dates cannot confirm overlap", () => {
    const lead: ProfileFacts = { ...noFacts, employment: [{ organisation: "Apex Technologies", title: null, start: null, end: null, ...q }] };
    const [c] = findConnections(ref, lead);
    expect(c.kind).toBe("employer");
    expect(c.overlap).toBe("unknown");
    expect(c.detail).toContain("cannot be checked");
  });

  it("reports non-overlapping shared employers honestly", () => {
    const lead: ProfileFacts = { ...noFacts, employment: [{ organisation: "Apex Technologies", title: null, start: "2010", end: "2014", ...q }] };
    expect(findConnections(ref, lead)[0].overlap).toBe("not_overlapping");
  });

  it("links a lead's current organisation to a shared past employer", () => {
    const lead: ProfileFacts = { ...noFacts, currentRole: { title: "CTO", organisation: "DataPulse", ...q } };
    expect(findConnections(ref, lead)[0].kind).toBe("employer");
  });

  it("matches places the reference physically lived or studied in", () => {
    const lead: ProfileFacts = { ...noFacts, location: { place: "Denver, CO", ...q } };
    const [c] = findConnections(ref, lead);
    expect(c.kind).toBe("place");
    expect(c.detail).toContain("based in");
  });

  it("does not treat a remote role's region as somewhere the reference was", () => {
    const lead: ProfileFacts = { ...noFacts, location: { place: "London, UK", ...q } };
    expect(findConnections(ref, lead)).toHaveLength(0);
    expect(referencePlaces(ref).map((p) => p.place)).not.toContain("UK");
  });

  it("returns nothing for unrelated backgrounds and no duplicates for repeats", () => {
    const lead: ProfileFacts = { ...noFacts, education: [{ institution: "Harvard", qualification: null, start: null, end: null, ...q }] };
    expect(findConnections(ref, lead)).toHaveLength(0);
    const twice: ProfileFacts = { ...noFacts, employment: [{ organisation: "Apex Technologies", title: null, start: null, end: null, ...q }, { organisation: "Apex Technologies Ltd", title: null, start: "2018", end: "2019", ...q }] };
    expect(findConnections(ref, twice)).toHaveLength(1);
  });

  it("never claims a relationship", () => {
    const lead: ProfileFacts = { ...noFacts, education: [{ institution: "Westfield University", qualification: null, start: "2022", end: "2024", ...q }] };
    const text = findConnections(ref, lead).map((c) => `${c.title} ${c.detail}`).join(" ").toLowerCase();
    expect(text).not.toMatch(/know each other|colleague|classmate|friend/);
  });
});
