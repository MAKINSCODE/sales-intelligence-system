import "dotenv/config";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN, withDb } from "./db";
import { signIn } from "./helpers";
import { quoteSupported } from "../src/lib/research/policy";

// Real Tavily + OpenAI against your dev server and dev worker. Prints the brief so a human can judge it.
test.skip(!process.env.OPENAI_API_KEY || !process.env.TAVILY_API_KEY, "API keys are not set");

test("a real lead produces a grounded brief within budget", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, E2E_ADMIN);

  await page.goto("/reference");
  await page.getByRole("button", { name: "Enter details manually" }).click();
  await page.getByLabel("Full name").fill("Jamiu Jimoh");
  await page.getByLabel("Based in").fill("Lagos State, Nigeria");
  await page.getByRole("button", { name: "Add education" }).click();
  await page.getByLabel("Institution").fill("Osun State University");
  await page.getByLabel(/^Start/).first().fill("2021");
  await page.getByLabel(/^End/).first().fill("2025");
  await page.getByRole("button", { name: "Approve and use" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved." })).toBeVisible();

  await page.goto("/leads/new");
  await page.locator("#firstName").fill(process.env.LIVE_FIRST ?? "Hatem");
  await page.locator("#lastName").fill(process.env.LIVE_LAST ?? "Hassan");
  await page.locator("#company").fill(process.env.LIVE_COMPANY ?? "Regulation and Supervision Bureau");
  await page.locator("#email").fill(process.env.LIVE_EMAIL ?? "hatem.hassan@rsbdubai.gov.ae");
  await page.locator("#country").fill("United Arab Emirates");
  if (process.env.LIVE_PROFILE) await page.locator("#profileUrl").fill(process.env.LIVE_PROFILE);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const started = Date.now();
  await page.getByRole("button", { name: "Review lead first" }).click();

  const brief = page.getByTestId("brief");
  const confirm = page.getByTestId("confirmation");
  await expect(brief.or(confirm)).toBeVisible({ timeout: 150_000 });
  if (await confirm.isVisible()) {
    console.log("\n=== CONFIRMATION SHOWN ===\n" + (await confirm.innerText()));
    // Only accept a candidate that is not a weak match; otherwise carry on with the organisation.
    const good = page.getByTestId("candidate").filter({ hasNotText: "Weak match" }).first();
    if (await good.count()) await good.getByRole("button", { name: "This is them" }).click();
    else await page.getByRole("button", { name: /continue with company information only/i }).click();
  }
  await expect(brief).toBeVisible({ timeout: 150_000 });
  console.log(`\n=== BRIEF READY in ${Math.round((Date.now() - started) / 1000)}s ===\n` + (await brief.innerText()));

  const runId = await withDb(async (c) => (await c.query(`select id from "ResearchRun" order by "createdAt" desc limit 1`)).rows[0].id as string);
  const data = await withDb(async (c) => {
    const run = (await c.query(`select status, searches, "pagesFetched", "llmCalls", "inputTokens", "outputTokens", limits, "activeMs" from "ResearchRun" where id=$1`, [runId])).rows[0];
    const linkedinPages = (await c.query(`select count(*)::int n from "Source" where "runId"=$1 and kind='PAGE' and domain like '%linkedin%'`, [runId])).rows[0].n;
    const quoted = (await c.query(`select c.statement, c.quote, s.text from "Claim" c join "Source" s on s.id=c."sourceId" where c."runId"=$1 and c.quote is not null`, [runId])).rows as { statement: string; quote: string; text: string }[];
    const offenders = quoted.filter((r) => !quoteSupported(r.quote, r.text)).map((r) => ({ statement: r.statement, quote: r.quote, sourceHead: r.text.slice(0, 200) }));
    const badQuotes = offenders.length;
    if (offenders.length) console.log("\n=== UNSUPPORTED QUOTES ===\n" + JSON.stringify(offenders, null, 1));
    const verifiedNoSource = (await c.query(`select count(*)::int n from "Claim" where "runId"=$1 and kind='FACT' and ("sourceId" is null or quote is null)`, [runId])).rows[0].n;
    return { run, linkedinPages, badQuotes, verifiedNoSource };
  });
  console.log("\n=== RUN DATA ===\n" + JSON.stringify(data, null, 1));

  expect(["COMPLETE", "PARTIAL"]).toContain(data.run.status);
  expect(data.linkedinPages).toBe(0);
  expect(data.verifiedNoSource).toBe(0);
  expect(data.run.searches).toBeLessThanOrEqual(data.run.limits.maxSearches);
  expect(data.run.pagesFetched).toBeLessThanOrEqual(data.run.limits.maxPages);
  expect(data.run.llmCalls).toBeLessThanOrEqual(data.run.limits.maxLlmCalls);
  expect(data.run.activeMs).toBeLessThan(data.run.limits.maxSeconds * 1000);
  expect(data.badQuotes).toBe(0);
});
