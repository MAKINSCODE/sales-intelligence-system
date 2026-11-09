import { describe, expect, it } from "vitest";
import { buildSnapshot, careerWithoutDuplicates, formatDay, initials, numberSources } from "./present";
import type { ClaimView, RunView } from "./view";

let n = 0;
const claim = (over: Partial<ClaimView>): ClaimView => ({ id: `c${++n}`, section: "WHO", kind: "FACT", statement: "x", quote: null, eventDate: null, detail: null, hidden: false, edited: false, originalStatement: null, source: null, ...over });
const src = (id: string, kind: "PAGE" | "SOCIAL_POST" = "PAGE") => ({ id, kind, url: `https://example.org/${id}`, domain: "example.org", title: `Title ${id}`, publishedAt: null, retrievedAt: "2026-10-13T10:00:00.000Z" });

describe("numberSources", () => {
  it("numbers sources by first use and reuses the number for repeats", () => {
    const claims = [claim({ source: src("a") }), claim({ source: src("b") }), claim({ source: src("a") }), claim({ source: null }), claim({ source: src("p", "SOCIAL_POST") })];
    const { sources, numberOf } = numberSources(claims);
    expect(sources.map((s) => [s.n, s.id, s.collected])).toEqual([[1, "a", false], [2, "b", false], [3, "p", true]]);
    expect(numberOf(claims[2])).toBe(1);
    expect(numberOf(claims[3])).toBeNull();
  });
});

describe("careerWithoutDuplicates", () => {
  it("hides the current role when the career repeats it", () => {
    const current = claim({ statement: "Head of Marketing at SAT" });
    const career = [claim({ statement: "Head of Marketing at SAT (2026-01 to present)" }), claim({ statement: "Analyst at Frost (2017 to 2021)" })];
    expect(careerWithoutDuplicates(current, career).map((c) => c.statement)).toEqual(["Analyst at Frost (2017 to 2021)"]);
    expect(careerWithoutDuplicates(undefined, career)).toHaveLength(2);
  });
});

describe("buildSnapshot", () => {
  const run = (claims: ClaimView[]): RunView =>
    ({ lead: { id: "l", name: "James Harrison", company: "City Bureau", jobTitle: "CEO", email: null, country: "US", profileUrl: null }, claims, brief: { opener: "Hi", questions: [], partial: [], droppedUnsupported: 0, rating: null, ratingNote: null, team: [], catalogue: null, postsCoverage: null } }) as unknown as RunView;

  it("summarises role, place, counts and the newest items", () => {
    const s = buildSnapshot(
      run([
        claim({ statement: "CEO at City Bureau", detail: { group: "current" } }),
        claim({ statement: "Based in Denver, CO", detail: { group: "location" } }),
        claim({ section: "NOW", statement: "old", eventDate: "2025-01-01" }),
        claim({ section: "NOW", statement: "new", eventDate: "2026-03-10" }),
        claim({ section: "ACTIVITY", kind: "COLLECTED", statement: "post", eventDate: "2026-09-01" }),
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "same school", detail: { overlap: "unknown" } }),
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "same employer", detail: { overlap: "overlapping" } }),
        claim({ section: "CONVERSATION", kind: "HYPOTHESIS", statement: "a trigger", detail: { role: "trigger" } }),
        claim({ section: "CONVERSATION", kind: "HYPOTHESIS", statement: "the angle", detail: { role: "angle" } }),
      ]),
    );
    expect(s).toMatchObject({ name: "James Harrison", role: "CEO at City Bureau", place: "Denver, CO" });
    expect(s.headline).toEqual({ verified: 2, connections: 2, news: 2, posts: 1 });
    expect(s.latestNews?.statement).toBe("new");
    expect(s.angle?.statement).toBe("the angle");
  });

  it("counts teammates, not links", () => {
    const s = buildSnapshot(
      run([
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "Our regulation team has worked the same utilities rules they now face.", detail: { commonGround: true, members: ["Ada"] } }),
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "link", detail: { member: "Ada", overlap: "overlapping" } }),
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "Ada and the lead both follow utilities regulation.", detail: { member: "Ada", summary: true } }),
        claim({ section: "CONNECTIONS", kind: "POTENTIAL", statement: "Bo summary", detail: { member: "Bo", summary: true } }),
      ]),
    );
    expect(s.headline.connections).toBe(2);
  });

  it("falls back to what was provided when nothing was verified", () => {
    const s = buildSnapshot(run([claim({ kind: "UNAVAILABLE", statement: "none" })]));
    expect(s.role).toBe("CEO at City Bureau");
    expect(s.place).toBe("US");
  });
});

describe("formatting", () => {
  it("makes initials from the first two words, including non-Latin names", () => {
    expect(initials("james harrison")).toBe("JH");
    expect(initials("الحسن حاتم")).toHaveLength(2);
    expect(initials("")).toBe("");
  });
  it("formats full dates, months and years, and passes through garbage", () => {
    expect(formatDay("2026-03-10")).toBe("10 Mar 2026");
    expect(formatDay("2026-03")).toBe("Mar 2026");
    expect(formatDay("2026")).toBe("2026");
    expect(formatDay("2026-09-28T09:00:00.000Z")).toBe("28 Sept 2026");
    expect(formatDay("sometime")).toBe("sometime");
    expect(formatDay(null)).toBeNull();
  });
});
