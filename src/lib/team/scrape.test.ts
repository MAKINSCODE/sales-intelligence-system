import { describe, expect, it, vi } from "vitest";
import { apifyProfileProvider, parseProfile, ProfileFetchError } from "./scrape";
import { fakeProfileProvider } from "./fake";
import { parseProfileUrls } from "./service";

const sample = {
  publicIdentifier: "jordan-lee",
  firstName: "Jordan",
  lastName: "Lee",
  headline: "Pharmacology | Medical Science Liaison",
  about: "I find myself at a unique crossroads.",
  location: { linkedinText: "Los Angeles, California, United States", parsed: { text: "Los Angeles, CA, United States" } },
  experience: [
    { position: "Staff Pharmacist | Prescription Dispensing, Regulatory Compliance", location: "Thousand Oaks, California, United States", workplaceType: "On-site", companyName: "CVS Health", startDate: { month: "Jan", year: 2024, text: "Jan 2024" }, endDate: { text: "Present" } },
    { position: "Application Scientist", location: "Dhaka, Bangladesh", workplaceType: null, companyName: "Bio-Xin Pvt. Ltd.", startDate: { month: "Sep", year: 2011, text: "Sep 2011" }, endDate: { month: "Apr", year: 2013, text: "Apr 2013" } },
    { position: "Remote consultant", location: "United Kingdom", workplaceType: "Remote", companyName: "DataPulse", startDate: { year: 2025, text: "2025" }, endDate: { year: 2026, text: "2026" } },
    { position: "Ghost", companyName: null },
  ],
  education: [{ schoolName: "KTH Royal Institute of Technology", degree: "Master of Science", fieldOfStudy: "Biotechnology", startDate: { year: 2007, text: "2007" }, endDate: { year: 2011, text: "2011" } }],
  skills: [{ name: "Pharmacology" }, { name: "Pharmacology" }, { name: "Data Analysis" }],
};

describe("parseProfile", () => {
  it("maps the documented output into the profile shape", () => {
    const p = parseProfile([sample]);
    expect(p.fullName).toBe("Jordan Lee");
    expect(p.homeBase).toBe("Los Angeles, CA, United States");
    expect(p.expertise).toEqual(["Pharmacology", "Data Analysis"]);
    expect(p.education).toEqual([{ institution: "KTH Royal Institute of Technology", qualification: "Master of Science, Biotechnology", start: "2007", end: "2011", location: null }]);
    expect(p.employment).toHaveLength(3);
    expect(p.employment[0]).toMatchObject({ organisation: "CVS Health", title: "Staff Pharmacist", start: "2024-01", end: "present", workMode: "onsite", location: "Thousand Oaks, California, United States" });
    expect(p.employment[1]).toMatchObject({ start: "2011-09", end: "2013-04", workMode: "unknown" });
  });

  it("keeps a remote role's place as the region it served, not somewhere the person was", () => {
    const remote = parseProfile([sample]).employment[2];
    expect(remote).toMatchObject({ workMode: "remote", location: null, regionServed: "United Kingdom", start: "2025", end: "2026" });
  });

  it("rejects an empty result or a profile with nothing to compare, so good data is never overwritten", () => {
    expect(() => parseProfile([])).toThrow(ProfileFetchError);
    expect(() => parseProfile("nope")).toThrow(ProfileFetchError);
    expect(() => parseProfile([{ publicIdentifier: "x", firstName: "X", experience: [], education: [] }])).toThrow(/no visible career/);
  });
});

describe("apifyProfileProvider", () => {
  it("asks for one profile by address and never echoes the response body on failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify([sample]), { status: 200 }));
    const p = await apifyProfileProvider("tok", fetchImpl as unknown as typeof fetch).fetchProfile("https://www.linkedin.com/in/jordan-lee");
    expect(p.fullName).toBe("Jordan Lee");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("harvestapi~linkedin-profile-scraper/run-sync-get-dataset-items");
    expect(JSON.parse(init.body)).toEqual({ profileScraperMode: "Profile details no email ($4 per 1k)", queries: ["https://www.linkedin.com/in/jordan-lee"] });
    expect(init.headers.Authorization).toBe("Bearer tok");

    const failing = vi.fn().mockResolvedValue(new Response("secret details", { status: 402 }));
    const err = await apifyProfileProvider("tok", failing as unknown as typeof fetch).fetchProfile("https://www.linkedin.com/in/nobody-here").catch((e) => e);
    expect(err).toBeInstanceOf(ProfileFetchError);
    expect(err.message).toBe("Profile collection failed (HTTP 402)");
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("refuses to start without a token", () => {
    expect(() => apifyProfileProvider("")).toThrow(/APIFY_TOKEN/);
  });
});

describe("fakeProfileProvider", () => {
  it("is deterministic by address and can simulate a missing profile", async () => {
    const fake = fakeProfileProvider();
    expect((await fake.fetchProfile("https://www.linkedin.com/in/piero-trivellato")).education[0].institution).toBe("Westfield University");
    expect((await fake.fetchProfile("https://www.linkedin.com/in/maria-rossi")).fullName).toBe("Maria Rossi");
    await expect(fake.fetchProfile("https://www.linkedin.com/in/missing-person")).rejects.toThrow(ProfileFetchError);
  });
});

describe("parseProfileUrls", () => {
  it("normalises, dedupes and reports what is not a profile address", () => {
    const r = parseProfileUrls("https://www.linkedin.com/in/Maria-Rossi/, linkedin.com/in/maria-rossi\nhttps://www.linkedin.com/company/acme-corp https://evil.example/in/x javascript:alert(1) https://uk.linkedin.com/in/chen-wei-181829a5?trk=x");
    expect(r.urls).toEqual(["https://www.linkedin.com/in/maria-rossi", "https://www.linkedin.com/in/chen-wei-181829a5"]);
    expect(r.invalid).toHaveLength(3);
  });
});
