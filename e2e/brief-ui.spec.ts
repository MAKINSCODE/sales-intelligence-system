import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, proceed, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

const PROFILE = "https://www.linkedin.com/in/hatem-hassan-rsb";

async function setupReferences(page: Page) {
  await page.goto("/reference");
  await page.locator("#catalogue-file").setInputFiles("docs/our_company.yaml");
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Imported version|already active/ })).toBeVisible();
}

async function briefFor(page: Page, profileUrl = PROFILE) {
  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Hatem");
  await page.locator("#lastName").fill("Hassan");
  await page.locator("#company").fill("RSB Dubai");
  await page.locator("#email").fill("hatem.hassan@rsbdubai.gov.ae");
  if (profileUrl) await page.locator("#profileUrl").fill(profileUrl);
  await page.locator("#enquiryText").fill("We want an AI agent to support our operational and executive functions across the bureau.");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hatem");
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  return page.url().split("/").pop()!;
}

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

test("the brief opens with a five-minute summary and can be navigated by section", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await setupReferences(page);
  await briefFor(page);

  const summary = page.locator("#summary");
  await expect(summary).toContainText("Hatem Hassan");
  await expect(summary).toContainText("Chief Executive at RSB Dubai");
  await expect(summary).toContainText("Your five-minute read");
  await expect(summary.getByText("Common ground")).toHaveCount(0);
  await expect(summary.getByText("Open with")).toHaveCount(0);
  await expect(summary.getByText("Closest teammate")).toHaveCount(0);
  const makers = page.locator("#decision-makers");
  await expect(makers).toContainText("Layla Karim, Chief Technology Officer");
  await expect(makers).not.toContainText("Hatem Hassan");
  await expect(summary.getByText("In the news")).toBeVisible();
  await expect(summary.getByText("Their feed")).toBeVisible();
  await expect(summary.getByText("Your angle")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Brief sections" });
  await expect(nav.getByRole("link")).toHaveText(["Summary", "Who they are", "Decision makers", "Fit with you", "Other signals", "What matters now", "LinkedIn", "Conversation", "Sources"]);
  await expect(page.getByTestId("brief").getByRole("heading", { name: "Qualification" })).toHaveCount(0);
  await expect(page.locator("#qualification")).toHaveCount(0);
  await nav.getByRole("link", { name: "Conversation" }).click();
  await expect(page.locator("#conversation")).toBeInViewport();
  await expect(nav.getByRole("link", { name: "Conversation" })).toHaveAttribute("aria-current", "location");

  // Tiles jump to their section.
  await page.locator("#summary").scrollIntoViewIfNeeded();
  await summary.getByRole("link", { name: /In the news/ }).click();
  await expect(page.locator("#now")).toBeInViewport();

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("the career is a timeline that collapses after three entries and the current role is not repeated", async ({ page }) => {
  await briefFor(page);
  const who = page.locator("#who");
  await expect(who.getByText("Career")).toBeVisible();
  const list = who.getByRole("list").filter({ hasText: "Gulf Utilities" });
  await expect(who.getByText("Deputy Director at Gulf Utilities (2018 to 2021)")).toBeVisible();
  await expect(who.getByText("Analyst at Sand Energy")).toHaveCount(0);
  const more = who.getByRole("button", { name: /Show 1 more entry/ });
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click();
  await expect(who.getByText("Analyst at Sand Energy (2006 to 2010)")).toBeVisible();
  await who.getByRole("button", { name: "Show fewer" }).click();
  await expect(who.getByText("Analyst at Sand Energy")).toHaveCount(0);
  await expect(who.getByText("Chief Executive at RSB Dubai")).toHaveCount(1);
  void list;
});

test("recent posts come only from the confirmed profile, labelled as collected by a third party, with injected text kept out", async ({ page }) => {
  await briefFor(page);
  const feed = page.locator("#activity");
  await expect(feed).toContainText("Collected by a third-party service");
  await expect(feed).toContainText("hatem-hassan-rsb");
  await expect(feed.getByText("Collected", { exact: true })).toHaveCount(3);
  await expect(feed.getByText("Proud to share that our team completed the district cooling consultation")).toBeVisible();
  await expect(feed.getByText("Industry update").first()).toBeVisible();
  await expect(feed.getByText("A post written by somebody else")).toHaveCount(0);
  await expect(feed.getByText("Congratulations to my colleague")).toHaveCount(0);
  await expect(feed).toContainText("2 items were discarded");
  await expect(feed.getByRole("link", { name: /Open post/ }).first()).toHaveAttribute("href", /linkedin\.com\/posts\//);
  await expect(feed.getByRole("link", { name: /Open post/ }).first()).toHaveAttribute("rel", /noopener/);

  // The injected instruction appears only as the post's own text, never in the conversation section.
  await expect(page.locator("#conversation").getByText(/billionaire/i)).toHaveCount(0);
  await expect(page.locator("#conversation")).toContainText("recent posts focus");
});

test("sources are numbered, cited next to the claim, and listed with dates", async ({ page }) => {
  await briefFor(page);
  const cite = page.locator("#who").getByRole("link", { name: "Source 1" }).first();
  await expect(cite).toBeVisible();
  await cite.click();
  await expect(page.locator("#src-1")).toBeInViewport();
  await expect(page.locator("#sources")).toContainText("publication date not stated");
  await expect(page.locator("#sources")).toContainText("collected by a third party");
});

test("the call plan can be copied, and has no opener or questions", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await briefFor(page);
  const conv = page.locator("#conversation");
  await expect(conv.getByRole("button", { name: "Copy opener" })).toHaveCount(0);
  await expect(conv.getByText("Questions worth asking")).toHaveCount(0);
  await conv.getByRole("button", { name: "Copy call plan" }).click();
  await expect(conv.getByText("Copied").first()).toBeVisible();
});

test("the lead header status updates by itself when research finishes", async ({ page }) => {
  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Hatem");
  await page.locator("#lastName").fill("Hassan");
  await page.locator("#company").fill("RSB Dubai");
  await page.locator("#email").fill("hatem.hassan@rsbdubai.gov.ae");
  await page.locator("#enquiryText").fill("We want AI agents for the bureau.");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hatem");
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("h1 + span, h1 ~ span").filter({ hasText: "Brief ready" }).first()).toBeVisible({ timeout: 15_000 });
});

test("the brief exports to a real PDF containing the name, sections, sources and posts", async ({ page }) => {
  await setupReferences(page);
  const leadId = await briefFor(page);

  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: "Export PDF" }).click()]);
  expect(download.suggestedFilename()).toBe("Brief - Hatem Hassan.pdf");
  const path = await download.path();
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(5_000);

  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const { text, total } = await parser.getText();
  await parser.destroy();
  expect(total).toBeGreaterThanOrEqual(1);
  for (const expected of [
    "Hatem Hassan",
    "Chief Executive at RSB Dubai",
    "Who they are",
    "Piero Trivellato also studied at Osun State University",
    "Latest LinkedIn activity",
    "Proud to share that our team completed",
    "Call plan",
    "Sources",
    "How to read this brief",
  ]) {
    expect(text, `PDF should contain "${expected}"`).toContain(expected);
  }
  expect(text).not.toMatch(/Export PDF|Refresh research|Save rating/);
  expect(text).not.toContain("made-up claim");

  // The button recovers so it can be used again.
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();
  void leadId;
});

test("PDF export is private: no session, someone else's lead, or no finished brief all refuse", async ({ page, browser }) => {
  const leadId = await briefFor(page);

  const anon = await browser.newContext();
  const res = await anon.request.get(`/api/leads/${leadId}/pdf`);
  expect(res.status()).toBe(401);
  const printRes = await anon.request.get(`/print/leads/${leadId}`, { maxRedirects: 0 });
  expect([302, 307, 308]).toContain(printRes.status());
  await anon.close();

  const member = uniqueEmail("pdf");
  await page.goto("/team");
  await page.locator("#emails").fill(member);
  await page.getByRole("button", { name: "Send invitations" }).click();
  const link = await page.getByTestId("invite-result").getByRole("link").first().getAttribute("href");
  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await p2.goto(link!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
  const other = await p2.evaluate(async (id) => (await fetch(`/api/leads/${id}/pdf`)).status, leadId);
  expect(other).toBe(404);

  await p2.goto("/leads/new");
  await p2.locator("#firstName").fill("Nobrief");
  await p2.locator("#lastName").fill("Yet");
  await p2.getByRole("button", { name: "Save lead" }).click();
  await expect(p2.getByRole("heading", { level: 1 })).toContainText("Nobrief");
  const empty = await p2.evaluate(async (id) => (await fetch(`/api/leads/${id}/pdf`)).status, p2.url().split("/").pop()!);
  expect(empty).toBe(404);
  await expect(p2.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
  await ctx.close();
});

test("the PDF button reports a failure and recovers", async ({ page }) => {
  await briefFor(page);
  await page.route("**/api/leads/*/pdf", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "The PDF could not be created. Please try again." }) }));
  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be created" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();
});

test("the redesigned brief is usable on a phone: no overflow, sticky navigation, tap targets", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await briefFor(page);
  await expectNoHorizontalOverflow(page);
  const nav = page.getByRole("navigation", { name: "Brief sections" });
  await expect(nav).toBeVisible();
  await page.locator("#sources").scrollIntoViewIfNeeded();
  await expect(nav).toBeInViewport();
  for (const loc of [page.getByRole("button", { name: "Export PDF" }), page.getByRole("button", { name: "Refresh research" })]) {
    const box = await loc.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  }
});
