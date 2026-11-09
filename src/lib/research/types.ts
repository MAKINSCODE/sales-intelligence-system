import type { ZodType } from "zod";
import type { ProfileForm } from "@/lib/team/profile";

export type Limits = {
  maxSeconds: number;
  maxSearches: number;
  maxPages: number;
  maxLlmCalls: number;
  maxPostRuns: number;
  maxPosts: number;
  maxInputTokensPerCall: number;
  maxOutputTokensPerCall: number;
};

export type SearchHit = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  score: number;
  publishedDate: string | null;
};

export type SearchOptions = { maxResults: number; topic?: "general" | "news"; timeRange?: "week" | "month" | "year" };

export type PageText = { url: string; text: string };

export interface SearchProvider {
  search(query: string, options: SearchOptions): Promise<SearchHit[]>;
  extract(urls: string[]): Promise<PageText[]>;
}

export type LlmRequest<T> = {
  name: string;
  schema: ZodType<T>;
  instructions: string;
  input: string;
  maxOutputTokens: number;
};

export interface LlmProvider {
  structured<T>(req: LlmRequest<T>): Promise<{ value: T; inputTokens: number; outputTokens: number }>;
}

export type RawPost = {
  id: string;
  url: string | null;
  text: string;
  postedAt: string | null;
  authorId: string | null;
  authorName: string | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  isRepost: boolean;
};

export type PostRequest = { profileUrl: string; maxPosts: number; maxChargeUsd: number };

// Posts come from a third-party collector and are only ever requested for one specific, confirmed profile.
export interface PostProvider {
  fetchPosts(req: PostRequest): Promise<RawPost[]>;
}

export type CompanyInfo = {
  name: string;
  linkedinUrl: string | null;
  industries: string[];
  employees: number | null;
  employeeRange: string | null;
  website: string | null;
  description: string | null;
  headquarters: string | null;
};

// Company details come from a third-party collector and are labelled as such wherever they are shown.
export interface CompanyProvider {
  lookup(req: { name: string; linkedinUrl?: string | null }): Promise<CompanyInfo | null>;
}

export type JobPosting = { title: string; url: string | null; postedAt: string | null; location: string | null; company: string | null };

export type JobsRequest = { companyName: string; companyUrl: string | null; maxItems: number };

export interface JobsProvider {
  search(req: JobsRequest): Promise<JobPosting[]>;
}

export type ProfilePhoto = { data: Buffer; contentType: string };

// The picture of one specific, confirmed profile; null when the profile has none.
export interface PhotoProvider {
  fetchPhoto(profileUrl: string): Promise<ProfilePhoto | null>;
}

// The structured details of one specific, confirmed LinkedIn profile, from a third-party collector.
export interface ProfileDetailsProvider {
  fetchProfile(linkedinUrl: string): Promise<ProfileForm>;
}

export type Providers = { search: SearchProvider; llm: LlmProvider; posts?: PostProvider; companies?: CompanyProvider; jobs?: JobsProvider; photos?: PhotoProvider; profiles?: ProfileDetailsProvider };
