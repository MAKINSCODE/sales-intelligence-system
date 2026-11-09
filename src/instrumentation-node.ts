import type { Instrumentation } from "next";
import { env } from "@/lib/env";
import { log } from "@/lib/log";

export function registerNode() {
  try {
    const e = env();
    log.info("web.ready", {
      node: process.version,
      providers: e.RESEARCH_PROVIDERS,
      postsEnabled: !!e.APIFY_TOKEN,
      llmConfigured: !!e.OPENAI_API_KEY,
      searchConfigured: !!e.TAVILY_API_KEY,
      mailConfigured: !!(e.SMTP_USER && e.SMTP_PASS),
    });
    if (process.env.NODE_ENV === "production" && !process.env.INTERNAL_APP_URL) log.warn("web.config", { note: "INTERNAL_APP_URL is not set; PDF export will use http://localhost:PORT" });
  } catch (err) {
    log.error("web.config_invalid", { err });
  }
}

export const reportRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  log.error("http.error", { method: request.method, path: request.path.split("?")[0], routeType: context.routeType, route: context.routePath, digest, err });
};
