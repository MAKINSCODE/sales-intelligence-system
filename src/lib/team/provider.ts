import "server-only";
import { env } from "@/lib/env";
import { fakeProfileProvider } from "./fake";
import { apifyProfileProvider, type ProfileProvider } from "./scrape";

// Built on first use, so a missing token is reported against the profile that needed it instead of crashing the worker.
export function profileProvider(): ProfileProvider {
  return {
    fetchProfile: (url) => (env().RESEARCH_PROVIDERS === "fake" ? fakeProfileProvider() : apifyProfileProvider()).fetchProfile(url),
  };
}
