import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { isSafeToRepeat, retry } from "@/lib/retry";
import { ProviderNotConfigured } from "./providers";
import type { PhotoProvider } from "./types";

const ACTOR = "harvestapi~linkedin-profile-scraper";
const MODE = "Profile details no email ($4 per 1k)";
const REQUEST_TIMEOUT_S = 90;
const MAX_CHARGE_USD = 0.05;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_BYTES = 400_000;
const WANTED_WIDTH = 400;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class PhotoError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const str = z.string().nullable().optional();
const item = z.looseObject({
  photo: str,
  profilePicture: z.looseObject({ url: str, sizes: z.array(z.looseObject({ url: str, width: z.number().nullable().optional() })).nullable().optional() }).nullable().optional(),
});

// Only LinkedIn's image CDN is ever fetched, so a crafted collector response cannot point the server at another host.
export function allowedPhotoUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)licdn\.com$/.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

// A mid-size rendition is sharp when enlarged and far smaller than the full 800px photo.
export function parsePhotoUrl(items: unknown): string | null {
  const first = Array.isArray(items) ? items.map((i) => item.safeParse(i)).find((r) => r.success) : undefined;
  if (!first?.success) return null;
  const { photo, profilePicture } = first.data;
  const sized = (profilePicture?.sizes ?? [])
    .filter((s) => allowedPhotoUrl(s.url) && typeof s.width === "number" && s.width >= WANTED_WIDTH)
    .sort((a, b) => a.width! - b.width!)[0];
  return allowedPhotoUrl(sized?.url) ?? allowedPhotoUrl(photo) ?? allowedPhotoUrl(profilePicture?.url);
}

async function download(url: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new PhotoError(`Photo download failed (HTTP ${res.status})`, res.status);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES.has(contentType)) throw new PhotoError("The photo was not a supported image type.");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new PhotoError("The photo was too large.");
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length === 0 || data.length > MAX_BYTES) throw new PhotoError("The photo was empty or too large.");
  return { data, contentType };
}

export function apifyPhotoProvider(token = env().APIFY_TOKEN, fetchImpl: typeof fetch = fetch): PhotoProvider {
  if (!token) throw new ProviderNotConfigured("APIFY_TOKEN is not set");

  return {
    async fetchPhoto(profileUrl) {
      const params = new URLSearchParams({ timeout: String(REQUEST_TIMEOUT_S), maxItems: "1", maxTotalChargeUsd: String(MAX_CHARGE_USD) });
      const body = JSON.stringify({ profileScraperMode: MODE, queries: [profileUrl] });
      // A run is billed, so only a failure where the request cannot have started the actor is repeated.
      const items = await retry(
        async () => {
          const res = await fetchImpl(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${params}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body,
            signal: AbortSignal.timeout((REQUEST_TIMEOUT_S + 15) * 1000),
          });
          if (!res.ok) throw new PhotoError(`Profile photo collection failed (HTTP ${res.status})`, res.status);
          return res.json();
        },
        { retries: 1, baseMs: 1500, maxMs: 4000, shouldRetry: isSafeToRepeat, onRetry: ({ attempt, delayMs, err }) => log.warn("provider.retry", { provider: "photo", attempt, delayMs, err }) },
      );
      const url = parsePhotoUrl(items);
      return url ? download(url, fetchImpl) : null;
    },
  };
}
