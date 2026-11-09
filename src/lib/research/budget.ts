import { log, type Fields, type Logger } from "@/lib/log";
import type { CompanyInfo, CompanyProvider, JobPosting, JobsProvider, JobsRequest, LlmProvider, LlmRequest, Limits, PageText, PhotoProvider, PostProvider, ProfileDetailsProvider, ProfilePhoto, PostRequest, Providers, RawPost, SearchHit, SearchOptions, SearchProvider } from "./types";

export class BudgetExceeded extends Error {
  constructor(public readonly resource: "time" | "searches" | "pages" | "llm" | "posts" | "collector") {
    super(`Research budget reached (${resource})`);
  }
}

export type Usage = { searches: number; pagesFetched: number; llmCalls: number; postRuns: number; inputTokens: number; outputTokens: number };

export class Budget {
  readonly usage: Usage;
  private readonly collectorRuns: Partial<Record<"posts" | "company" | "jobs" | "photo" | "profile", number>> = {};
  private readonly deadline: number;

  constructor(
    readonly limits: Limits,
    startedAt = Date.now(),
    usage?: Partial<Usage>,
    private readonly now: () => number = Date.now,
  ) {
    this.deadline = startedAt + limits.maxSeconds * 1000;
    this.usage = { searches: 0, pagesFetched: 0, llmCalls: 0, postRuns: 0, inputTokens: 0, outputTokens: 0, ...usage };
  }

  get deadlineAt() {
    return new Date(this.deadline);
  }

  remainingMs() {
    return Math.max(0, this.deadline - this.now());
  }

  assertTime() {
    if (this.now() >= this.deadline) throw new BudgetExceeded("time");
  }

  // Reserve before the call so a failed or retried call still counts against the cap.
  spendSearch() {
    this.assertTime();
    if (this.usage.searches >= this.limits.maxSearches) throw new BudgetExceeded("searches");
    this.usage.searches++;
  }

  spendPages(n: number) {
    this.assertTime();
    const room = this.limits.maxPages - this.usage.pagesFetched;
    if (room <= 0) throw new BudgetExceeded("pages");
    const granted = Math.min(n, room);
    this.usage.pagesFetched += granted;
    return granted;
  }

  spendLlm() {
    this.assertTime();
    if (this.usage.llmCalls >= this.limits.maxLlmCalls) throw new BudgetExceeded("llm");
    this.usage.llmCalls++;
  }

  // Each collector (posts, company page, job listings) may start up to maxPostRuns billed runs, counted per kind
  // so a low cap cannot let the company lookup use up the allowance of the others.
  spendPostRun(kind: "posts" | "company" | "jobs" | "photo" | "profile" = "posts") {
    this.assertTime();
    const used = this.collectorRuns[kind] ?? 0;
    if (used >= this.limits.maxPostRuns) throw new BudgetExceeded(kind === "posts" ? "posts" : "collector");
    this.collectorRuns[kind] = used + 1;
    this.usage.postRuns++;
  }

  addTokens(input: number, output: number) {
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
  }

  canSearch() {
    return this.usage.searches < this.limits.maxSearches && this.remainingMs() > 0;
  }

  canFetch() {
    return this.usage.pagesFetched < this.limits.maxPages && this.remainingMs() > 0;
  }

  canCallLlm() {
    return this.usage.llmCalls < this.limits.maxLlmCalls && this.remainingMs() > 0;
  }
}

// Bound inputs so one oversized prompt cannot blow the token budget.
export const clip = (text: string, maxChars: number) => (text.length > maxChars ? `${text.slice(0, maxChars)}\n[truncated]` : text);

// The time limit is hard: a provider that hangs (slow or dropped connection) cannot hold a run past its deadline.
export function raceDeadline<T>(call: Promise<T>, budget: Budget): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BudgetExceeded("time")), budget.remainingMs());
  });
  // If the deadline wins, a later failure of the abandoned call must not surface as an unhandled rejection.
  call.catch(() => undefined);
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

async function observed<T>(logger: Logger, provider: string, fields: Fields, call: () => Promise<T>, summarize: (result: T) => Fields): Promise<T> {
  const start = Date.now();
  try {
    const result = await call();
    logger.info("provider.call", { provider, ...fields, ok: true, ms: Date.now() - start, ...summarize(result) });
    return result;
  } catch (err) {
    const limit = err instanceof BudgetExceeded;
    logger[limit ? "warn" : "error"]("provider.call", { provider, ...fields, ok: false, ms: Date.now() - start, limit: limit ? err.resource : undefined, err: limit ? undefined : err });
    throw err;
  }
}

export function withBudget(providers: Providers, budget: Budget, onSpend?: () => Promise<void>, logger: Logger = log): Providers {
  const search: SearchProvider = {
    search: (query: string, options: SearchOptions): Promise<SearchHit[]> => {
      logger.debug("provider.query", { provider: "search", query });
      return observed(
        logger,
        "search",
        { topic: options.topic ?? "general", queryChars: query.length },
        async () => {
          budget.spendSearch();
          try {
            return await raceDeadline(providers.search.search(query, options), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ results: r.length }),
      );
    },
    extract: (urls: string[]): Promise<PageText[]> =>
      observed(
        logger,
        "extract",
        { requested: urls.length },
        async () => {
          const granted = budget.spendPages(urls.length);
          try {
            return await raceDeadline(providers.search.extract(urls.slice(0, granted)), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ pages: r.length }),
      ),
  };

  const llm: LlmProvider = {
    structured: <T>(req: LlmRequest<T>) =>
      observed(
        logger,
        "llm",
        { name: req.name },
        async () => {
          budget.spendLlm();
          const maxOutputTokens = Math.min(req.maxOutputTokens, budget.limits.maxOutputTokensPerCall);
          try {
            const out = await raceDeadline(providers.llm.structured({ ...req, maxOutputTokens, input: clip(req.input, budget.limits.maxInputTokensPerCall * 3) }), budget);
            budget.addTokens(out.inputTokens, out.outputTokens);
            return out;
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ inputTokens: r.inputTokens, outputTokens: r.outputTokens }),
      ),
  };

  const posts: PostProvider | undefined = providers.posts && {
    fetchPosts: (req: PostRequest): Promise<RawPost[]> =>
      observed(
        logger,
        "posts",
        { maxPosts: Math.min(req.maxPosts, budget.limits.maxPosts) },
        async () => {
          budget.spendPostRun();
          try {
            return await raceDeadline(providers.posts!.fetchPosts({ ...req, maxPosts: Math.min(req.maxPosts, budget.limits.maxPosts) }), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ returned: r.length }),
      ),
  };

  const companies: CompanyProvider | undefined = providers.companies && {
    lookup: (req): Promise<CompanyInfo | null> =>
      observed(
        logger,
        "company",
        {},
        async () => {
          budget.spendPostRun("company");
          try {
            return await raceDeadline(providers.companies!.lookup(req), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ found: !!r }),
      ),
  };

  const jobs: JobsProvider | undefined = providers.jobs && {
    search: (req: JobsRequest): Promise<JobPosting[]> =>
      observed(
        logger,
        "jobs",
        {},
        async () => {
          budget.spendPostRun("jobs");
          try {
            return await raceDeadline(providers.jobs!.search(req), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ returned: r.length }),
      ),
  };

  const photos: PhotoProvider | undefined = providers.photos && {
    fetchPhoto: (profileUrl: string): Promise<ProfilePhoto | null> =>
      observed(
        logger,
        "photo",
        {},
        async () => {
          budget.spendPostRun("photo");
          try {
            return await raceDeadline(providers.photos!.fetchPhoto(profileUrl), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ found: !!r }),
      ),
  };

  const profiles: ProfileDetailsProvider | undefined = providers.profiles && {
    fetchProfile: (url: string) =>
      observed(
        logger,
        "profile",
        {},
        async () => {
          budget.spendPostRun("profile");
          try {
            return await raceDeadline(providers.profiles!.fetchProfile(url), budget);
          } finally {
            await onSpend?.();
          }
        },
        (r) => ({ jobs: r.employment.length }),
      ),
  };

  return { search, llm, posts, companies, jobs, photos, profiles };
}
