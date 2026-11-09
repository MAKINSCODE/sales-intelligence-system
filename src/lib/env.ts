import { z } from "zod";

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  BOOTSTRAP_ADMIN_EMAILS: z.string().default(""),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_PREFIX: z.string().default("sales-intel:local"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4.1"),
  TAVILY_API_KEY: z.string().default(""),
  APIFY_TOKEN: z.string().default(""),
  APIFY_POST_QUERY: z.string().default("the OR and OR of OR to OR in"),
  APIFY_MAX_CHARGE_USD: z.coerce.number().positive().default(0.25),
  SMTP_HOST: z.string().default("smtp-relay.brevo.com"),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  MAIL_FROM_ADDRESS: z.string().email().default("notifications@example.com"),
  MAIL_FROM_NAME: z.string().default("Sales Intelligence"),
  RESEARCH_MAX_SECONDS: z.coerce.number().int().positive().default(420),
  RESEARCH_MAX_SEARCHES: z.coerce.number().int().positive().default(14),
  RESEARCH_MAX_PAGES: z.coerce.number().int().positive().default(20),
  RESEARCH_MAX_LLM_CALLS: z.coerce.number().int().positive().default(14),
  RESEARCH_MAX_POSTS: z.coerce.number().int().positive().default(12),
  RESEARCH_MAX_POST_RUNS: z.coerce.number().int().min(0).default(3),
  RESEARCH_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RESEARCH_PROVIDERS: z.enum(["live", "fake"]).default("live"),
  DEV_SHOW_MAGIC_LINK: bool,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.DEV_SHOW_MAGIC_LINK && process.env.NODE_ENV === "production") {
    throw new Error("DEV_SHOW_MAGIC_LINK must not be enabled in production");
  }
  if (parsed.data.RESEARCH_PROVIDERS === "fake" && process.env.NODE_ENV === "production") {
    throw new Error("RESEARCH_PROVIDERS=fake must not be used in production");
  }
  cached = parsed.data;
  return cached;
}
