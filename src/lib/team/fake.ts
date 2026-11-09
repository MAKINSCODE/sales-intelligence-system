import { profileFormSchema, type ProfileForm } from "./profile";
import { ProfileFetchError, type ProfileProvider } from "./scrape";

const base = { headline: null, summary: null, homeBase: null, education: [], employment: [], expertise: [] };

// Deterministic stand-ins keyed by profile address, for automated tests that must not call a paid service.
const FIXTURES: Record<string, Partial<ProfileForm>> = {
  "piero-trivellato": {
    fullName: "Jordan Lee",
    headline: "Managing Director",
    homeBase: "Denver, CO",
    education: [{ institution: "Westfield University", qualification: null, start: "2021", end: "2025", location: "Springfield, OH" }],
    expertise: ["Sales leadership"],
  },
  "chen-wei-181829a5": {
    fullName: "Chen Wei",
    headline: "Business Development",
    employment: [{ organisation: "Apex Utilities", title: "Account Manager", start: "2019", end: "2022", location: "London, United Kingdom", workMode: "onsite", regionServed: null }],
  },
};

export function fakeProfileProvider(): ProfileProvider {
  return {
    async fetchProfile(linkedinUrl) {
      const slug = decodeURIComponent(linkedinUrl.slice(linkedinUrl.lastIndexOf("/") + 1)).toLowerCase();
      if (slug.includes("missing")) throw new ProfileFetchError("No profile data was returned for that address.");
      const fixture = FIXTURES[slug] ?? {
        fullName: slug.replace(/[-_]?[0-9a-f]{6,}$/, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Team Member",
        employment: [{ organisation: "Example Co", title: "Consultant", start: "2015", end: "present", location: null, workMode: "unknown", regionServed: null }],
      };
      return profileFormSchema.parse({ ...base, ...fixture });
    },
  };
}
