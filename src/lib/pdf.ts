import "server-only";
import { chromium, type Browser } from "playwright-core";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { log } from "@/lib/log";

export class PdfError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

// Always a fixed internal address: never derived from the request, so a forged Host header cannot send the
// session cookie to another site.
export const internalOrigin = () => process.env.INTERNAL_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

const globalForBrowser = globalThis as unknown as { pdfBrowser?: Promise<Browser> };

function browser(): Promise<Browser> {
  const existing = globalForBrowser.pdfBrowser;
  if (existing) {
    return existing.then((b) => (b.isConnected() ? b : (globalForBrowser.pdfBrowser = launch())), () => (globalForBrowser.pdfBrowser = launch()));
  }
  return (globalForBrowser.pdfBrowser = launch());
}

function launch() {
  return chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_NO_SANDBOX === "true" ? ["--no-sandbox"] : [],
  });
}

const inFlight = new Set<string>();

// Each render is a full browser page, so a small server is protected from many exports at once.
const MAX_CONCURRENT = Math.max(1, Number(process.env.PDF_MAX_CONCURRENT) || 2);
const RENDER_DEADLINE_MS = 70_000;
let active = 0;

export function asciiFilename(name: string) {
  const base = name.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  return `Brief - ${base || "lead"}.pdf`;
}

export async function renderBriefPdf(args: { leadId: string; sessionToken: string; userId: string; footerName: string }): Promise<Buffer> {
  if (inFlight.has(args.userId)) throw new PdfError("A PDF is already being prepared. Please wait a moment.", 429);
  if (active >= MAX_CONCURRENT) {
    log.warn("pdf.busy", { active, max: MAX_CONCURRENT });
    throw new PdfError("Several PDFs are being prepared right now. Please try again in a moment.", 503);
  }
  inFlight.add(args.userId);
  active++;
  const start = Date.now();
  let timedOut = false;
  let killer: ReturnType<typeof setTimeout> | undefined;

  const origin = internalOrigin();
  let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
  try {
    context = await (await browser()).newContext({ viewport: { width: 900, height: 1200 }, locale: "en-GB" });
    // Whatever step is slow, the whole export is cut off at one deadline so a request never hangs on a bad link.
    const ctx = context;
    killer = setTimeout(() => {
      timedOut = true;
      void ctx.close().catch(() => undefined);
    }, RENDER_DEADLINE_MS);
    await context.addCookies([{ name: SESSION_COOKIE, value: args.sessionToken, url: origin, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    page.setDefaultTimeout(40_000);

    const res = await page.goto(`${origin}/print/leads/${encodeURIComponent(args.leadId)}`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/login")) throw new PdfError("Your session has expired. Please sign in again.", 401);
    if (!res || !res.ok()) throw new PdfError("The brief could not be loaded.", 502);
    await page.waitForSelector("[data-print-ready]", { timeout: 30_000 }).catch(() => {
      throw new PdfError("There is no finished brief to export yet.", 404);
    });
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ media: "print" });

    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "18mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;padding:0 12mm;font-family:Arial,sans-serif;font-size:8px;color:#5c5c5c;display:flex;justify-content:space-between"><span>${esc(args.footerName)} &middot; Sales Intelligence</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    });
    log.info("pdf.render.ok", { leadId: args.leadId, ms: Date.now() - start, bytes: pdf.length });
    return Buffer.from(pdf);
  } catch (e) {
    if (timedOut) {
      log.error("pdf.render.timeout", { leadId: args.leadId, ms: Date.now() - start });
      throw new PdfError("The PDF took too long to prepare. Please try again.", 504);
    }
    if (e instanceof PdfError) {
      log.warn("pdf.render.refused", { leadId: args.leadId, status: e.status, reason: e.message });
      throw e;
    }
    log.error("pdf.render.failed", { leadId: args.leadId, ms: Date.now() - start, err: e });
    throw new PdfError("The PDF could not be created. Please try again.", 500);
  } finally {
    clearTimeout(killer);
    await context?.close().catch(() => undefined);
    inFlight.delete(args.userId);
    active--;
  }
}
