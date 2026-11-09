import { describe, expect, it } from "vitest";
import { emptyProfile, fromRow, profileFormSchema, toStored } from "./profile";

const base = { fullName: "Alex Johnson", education: [], expertise: [] };

describe("profileFormSchema", () => {
  it("turns a remote role into a region served, never a location", () => {
    const p = profileFormSchema.parse({
      ...base,
      employment: [{ organisation: "DataPulse", workMode: "remote", location: "UK", start: "2025-12", end: "2026-04" }],
    });
    expect(p.employment[0].location).toBeNull();
    expect(p.employment[0].regionServed).toBe("UK");
  });

  it("keeps the physical location of on-site roles", () => {
    const p = profileFormSchema.parse({
      ...base,
      employment: [{ organisation: "Apex Tech", workMode: "onsite", location: "Denver, CO", start: "2017-11", end: "2020-05" }],
    });
    expect(p.employment[0].location).toBe("Denver, CO");
  });

  it("treats blank strings as absent and trims", () => {
    const p = profileFormSchema.parse({ ...base, fullName: "  Ada  ", headline: "   ", employment: [], homeBase: "" });
    expect(p.fullName).toBe("Ada");
    expect(p.headline).toBeNull();
    expect(p.homeBase).toBeNull();
  });

  it("rejects malformed dates and missing required names", () => {
    const bad = profileFormSchema.safeParse({
      ...base,
      employment: [{ organisation: "X", workMode: "unknown", start: "May 2021" }],
    });
    expect(bad.success).toBe(false);
    expect(profileFormSchema.safeParse({ ...base, fullName: " " }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...base, education: [{ institution: "" }] }).success).toBe(false);
  });

  it("accepts present as an end date", () => {
    const p = profileFormSchema.parse({ ...base, employment: [{ organisation: "Acme", workMode: "unknown", start: "2026-05", end: "Present" }] });
    expect(p.employment[0].end).toBe("Present");
  });
});

describe("storage round trip", () => {
  it("stores the home base as a stated location and restores it", () => {
    const p = { ...emptyProfile("A"), homeBase: "Denver, CO" };
    const stored = toStored(p);
    expect(stored.locations).toEqual([{ place: "Denver, CO", basis: "stated_home_base" }]);
    const back = fromRow({ fullName: "A", headline: null, summary: null, expertise: [], ...stored });
    expect(back.homeBase).toBe("Denver, CO");
  });
});
