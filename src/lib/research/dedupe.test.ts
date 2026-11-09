import { describe, expect, it } from "vitest";
import { validateProfileFacts, type EvidenceSource, type ProfileFacts } from "./evidence";

const s = (id: string, text: string): EvidenceSource => ({ id, url: `https://x.example/${id}`, title: `T ${id}`, text, publishedAt: null });
const text = "He studied at Westfield University from 2022 to 2024. He worked as Engineer at Nile Grid from 2010 to 2014.";
const facts = (sourceId: string): ProfileFacts => ({
  currentRole: null,
  location: null,
  education: [{ institution: "Westfield University", qualification: null, start: "2022", end: "2024", quote: "studied at Westfield University from 2022 to 2024", sourceId }],
  employment: [{ organisation: "Nile Grid", title: "Engineer", start: "2010", end: "2014", quote: "worked as Engineer at Nile Grid from 2010 to 2014", sourceId }],
});

describe("validateProfileFacts de-duplication", () => {
  it("lists a fact found in several sources once, keeping the first source", () => {
    const merged: ProfileFacts = { ...facts("a"), education: [...facts("a").education, ...facts("b").education], employment: [...facts("a").employment, ...facts("b").employment] };
    const { value } = validateProfileFacts(merged, [s("a", text), s("b", text)]);
    expect(value.education).toHaveLength(1);
    expect(value.employment).toHaveLength(1);
    expect(value.education[0].sourceId).toBe("a");
  });

  it("keeps genuinely different entries at the same organisation", () => {
    const f = facts("a");
    const other = { ...f.employment[0], title: "Manager", start: "2014", end: "2018", quote: "worked as Engineer at Nile Grid from 2010 to 2014" };
    const { value } = validateProfileFacts({ ...f, employment: [...f.employment, other] }, [s("a", text)]);
    expect(value.employment).toHaveLength(2);
  });

  it("treats accents and case in names as the same entry", () => {
    const f = facts("a");
    const dup = { ...f.education[0], institution: "WESTFIELD UNIVERSITY" };
    expect(validateProfileFacts({ ...f, education: [...f.education, dup] }, [s("a", text)]).value.education).toHaveLength(1);
  });
});
