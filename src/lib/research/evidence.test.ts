import { describe, expect, it, vi } from "vitest";
import { extractAnnouncements, extractProfileFacts, validateProfileFacts, type EvidenceSource, type ProfileFacts } from "./evidence";

const src = (id: string, text: string, over: Partial<EvidenceSource> = {}): EvidenceSource => ({ id, url: `https://example.org/${id}`, title: `Page ${id}`, text, publishedAt: null, ...over });

const empty: ProfileFacts = { currentRole: null, location: null, education: [], employment: [] };

describe("validateProfileFacts", () => {
  const sources = [src("s1", "James Harrison is the Chief Executive of City Bureau. He studied at Westfield University from 1995 to 1999.")];

  it("keeps entries whose quote appears in the cited source", () => {
    const { value, dropped } = validateProfileFacts(
      {
        ...empty,
        currentRole: { title: "Chief Executive", organisation: "City Bureau", quote: "is the Chief Executive of City Bureau", sourceId: "s1" },
        education: [{ institution: "Westfield University", qualification: null, start: "1995", end: "1999", quote: "studied at Westfield University from 1995 to 1999", sourceId: "s1" }],
      },
      sources,
    );
    expect(value.currentRole?.title).toBe("Chief Executive");
    expect(value.education).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("drops invented quotes and reports why", () => {
    const { value, dropped } = validateProfileFacts(
      {
        ...empty,
        employment: [{ organisation: "Google", title: "VP", start: "2010", end: "2015", quote: "worked as a Vice President at Google for five years", sourceId: "s1" }],
      },
      sources,
    );
    expect(value.employment).toHaveLength(0);
    expect(dropped).toEqual([{ reason: "quote_not_in_source", entry: "employment Google" }]);
  });

  it("drops a current role that states neither a title nor an organisation", () => {
    const { value } = validateProfileFacts({ ...empty, currentRole: { title: null, organisation: null, quote: "is the Chief Executive of City Bureau", sourceId: "s1" } }, sources);
    expect(value.currentRole).toBeNull();
  });

  it("drops entries citing a source that was never supplied", () => {
    const { value, dropped } = validateProfileFacts({ ...empty, location: { place: "Dubai", quote: "based in Dubai, UAE", sourceId: "ghost" } }, sources);
    expect(value.location).toBeNull();
    expect(dropped[0].reason).toBe("unknown_source");
  });

  it("does not accept a real quote attributed to the wrong source", () => {
    const two = [...sources, src("s2", "Unrelated page about urban transit.")];
    const { value } = validateProfileFacts({ ...empty, currentRole: { title: "CE", organisation: "City Bureau", quote: "is the Chief Executive of City Bureau", sourceId: "s2" } }, two);
    expect(value.currentRole).toBeNull();
  });
});

describe("extractProfileFacts / extractAnnouncements", () => {
  it("makes no model call when there are no sources", async () => {
    const structured = vi.fn();
    const out = await extractProfileFacts("A B", "", [], { structured });
    expect(structured).not.toHaveBeenCalled();
    expect(out.value.employment).toEqual([]);
    expect((await extractAnnouncements("X", [], { structured })).value).toEqual([]);
  });

  it("passes only the supplied sources and filters the model's answer", async () => {
    const structured = vi.fn().mockResolvedValue({
      value: { items: [
        { about: "company", statement: "City Bureau launched a transit initiative", date: "2026-03", quote: "launched a new urban transit initiative", sourceId: "n1" },
        { about: "company", statement: "City Bureau won an award", date: "2026-04", quote: "won the global innovation award", sourceId: "n1" },
      ] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const out = await extractAnnouncements("City Bureau", [src("n1", "In March the bureau launched a new urban transit initiative for the region.")], { structured });
    expect(out.value).toHaveLength(1);
    expect(out.value[0].date).toBe("2026-03");
    expect(out.dropped).toHaveLength(1);
    expect(structured.mock.calls[0][0].input).toContain("[source n1]");
  });

  it("includes publication dates for the model to use", async () => {
    const structured = vi.fn().mockResolvedValue({ value: { items: [] }, inputTokens: 1, outputTokens: 1 });
    await extractAnnouncements("X", [src("n1", "text", { publishedAt: new Date("2026-02-01") })], { structured });
    expect(structured.mock.calls[0][0].input).toContain("published 2026-02-01");
  });
});
