import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { expectNoHorizontalOverflow, proceed, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 120_000 });

async function createLead(page: Page, fields: Record<string, string>) {
  await page.goto("/leads/new");
  for (const [id, value] of Object.entries(fields)) await page.locator(`#${id}`).fill(value);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fields.firstName);
}

const hatem = { firstName: "Hatem", lastName: "Hassan", company: "RSB Dubai", email: "hatem.hassan@rsbdubai.gov.ae" };

async function briefFor(page: Page, enquiry: string, extra: Record<string, string> = {}) {
  await createLead(page, { ...hatem, enquiryText: enquiry, ...extra });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 90_000 });
}

async function setRules(page: Page, minEmployees: string) {
  await page.goto("/reference");
  await page.locator("#q-employees").fill(minEmployees);
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

test("a personal email is disqualified before any research, and can be researched anyway", async ({ page }) => {
  await createLead(page, { ...hatem, email: "hatem@gmail.com", enquiryText: "We want to roll out AI agents." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  const card = page.getByTestId("screened-out");
  await expect(card).toContainText("Disqualified before research", { timeout: 60_000 });
  await expect(card).toContainText("Submitted with a personal email address.");
  await expect(page.getByTestId("brief")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await card.getByRole("button", { name: "Research anyway" }).click();
  await page.getByRole("button", { name: "This is them" }).click({ timeout: 60_000 });
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("decision-final")).toHaveCount(0);
});

test("a request for a job is disqualified even from a work email", async ({ page }) => {
  await createLead(page, { ...hatem, enquiryText: "I am looking for a job. Please find my CV attached." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("screened-out")).toContainText("The enquiry asks about a job.", { timeout: 60_000 });
});

test("a large company with a work email and a target phrase qualifies, with each rule shown on the review card", async ({ page }) => {
  await createLead(page, { ...hatem, enquiryText: "We want to roll out AI agents across the bureau." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  const card = page.getByTestId("awaiting-approval");
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("review-status")).toContainText("Qualified");
  const rules = card.getByTestId("qualification-rules");
  await expect(rules.locator("li[data-outcome=pass]")).toHaveCount(6);
  await expect(rules).toContainText("About USD 150 million a year");

  await expectNoHorizontalOverflow(page);

  // The finished brief carries no qualification section: the recommendation is only for deciding whether to go on.
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("decision-final")).toHaveCount(0);
  await expect(page.getByTestId("qualification-rules")).toHaveCount(0);
});

test("a company known to be too small is recommended against, and the person can still proceed anyway", async ({ page }) => {
  try {
    await setRules(page, "1000");
    await createLead(page, { ...hatem, enquiryText: "We want to roll out AI agents across the bureau." });
    await page.getByRole("button", { name: "Review lead first" }).click();
    const card = page.getByTestId("awaiting-approval");
    await expect(card).toContainText("About 320 employees, below the minimum of 1,000", { timeout: 90_000 });
    await expect(page.getByTestId("review-status")).toContainText("Disqualified");
    await expect(page.getByTestId("brief")).toHaveCount(0);
    await expect(card.getByTestId("qualification-rules")).toContainText("At least 1,000 employees");
    await card.getByRole("button", { name: "Proceed anyway" }).click();
    await expect(page.getByTestId("brief")).toBeVisible({ timeout: 90_000 });
  } finally {
    await setRules(page, "100");
  }
});

test("details the lead left out are filled in from public sources and shown on the review panel", async ({ page }) => {
  await createLead(page, { firstName: "Hatem", lastName: "Hassan", profileUrl: "https://www.linkedin.com/in/hatem-hassan-rsb", enquiryText: "We want to roll out AI agents across the bureau." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  const card = page.getByTestId("awaiting-approval");
  const them = page.getByRole("button", { name: "This is them" });
  await expect(card.or(them)).toBeVisible({ timeout: 90_000 });
  if (await them.isVisible()) await them.click();

  const found = card.getByTestId("found-online");
  await expect(found).toContainText("Company:", { timeout: 90_000 });
  await expect(found).toContainText("RSB Dubai");
  await expect(found).toContainText("Job title:");
  await expect(found).toContainText("Chief Executive");
  await expect(page.getByTestId("review-status")).toContainText("Qualified");

  const details = page.getByTestId("lead-details");
  await expect(details).toContainText("RSB Dubai");
  await expect(details.getByText("Found online").first()).toBeVisible();
  await expect(details).toContainText("Not provided");
});

test("a qualified lead also waits for the person's decision, and declining stops before the brief", async ({ page }) => {
  await createLead(page, { ...hatem, enquiryText: "We want to roll out AI agents across the bureau." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  const card = page.getByTestId("awaiting-approval");
  await expect(card).toContainText("Review before the brief", { timeout: 90_000 });
  await expect(page.getByTestId("review-status")).toContainText("Qualified");
  await expect(card).toContainText("Identified as Chief Executive at RSB Dubai");
  await expect(page.getByTestId("brief")).toHaveCount(0);

  await card.getByRole("button", { name: "Don't proceed" }).click();
  await expect(page.getByTestId("screened-out")).toContainText("Rejected after review");
  await expect(page.getByTestId("brief")).toHaveCount(0);
});

// Fail Case is found by the fake providers, but nothing is known about Acme, so the rules cannot settle it.
async function waitForDecision(page: Page) {
  await createLead(page, { firstName: "Fail", lastName: "Case", company: "Acme" });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await page.getByTestId("candidate").first().getByRole("button", { name: "This is them" }).click({ timeout: 90_000 });
  return page.getByTestId("awaiting-approval");
}

test("a lead the rules cannot judge waits for a person after the person is identified, who can approve it", async ({ page }) => {
  const card = await waitForDecision(page);
  await expect(card).toContainText("Review before the brief", { timeout: 90_000 });
  await expect(page.getByTestId("review-status")).toContainText("Needs your judgement");
  await expect(card).toContainText("headcount could not be found");
  await expect(page.getByTestId("brief")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await card.getByRole("button", { name: "Proceed to brief" }).click();
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 90_000 });
});

test("a lead the rules cannot judge can be rejected, and still researched anyway", async ({ page }) => {
  const card = await waitForDecision(page);
  await card.getByRole("button", { name: "Don't proceed" }).click({ timeout: 90_000 });
  const rejected = page.getByTestId("screened-out");
  await expect(rejected).toContainText("Rejected after review");
  await expect(page.getByTestId("brief")).toHaveCount(0);
  await expect(rejected.getByRole("button", { name: "Research anyway" })).toBeVisible();
});

test("research can be started over or deleted, even while waiting for a decision", async ({ page }) => {
  const card = await waitForDecision(page);
  await expect(card).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Start over" }).click();
  await expect(page.getByTestId("confirmation")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Delete brief" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("button", { name: "Review lead first" })).toBeVisible();
  await expect(page.getByTestId("brief-panel")).toHaveCount(0);
});

test("an enquiry that does not match what Jada does is stopped before any research", async ({ page }) => {
  await createLead(page, { ...hatem, enquiryText: "Please send me your price list for office chairs." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("screened-out")).toContainText("does not look like something Jada can help with", { timeout: 60_000 });
});

test("admins must give a headcount threshold; members only read the rules", async ({ page, browser }) => {
  await page.goto("/reference");
  await page.locator("#q-employees").fill("");
  await page.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a number of employees" })).toBeVisible();

  const member = uniqueEmail("rules");
  await page.goto("/team");
  await page.locator("#emails").fill(member);
  await page.getByRole("button", { name: "Send invitations" }).click();
  const url = await page.getByTestId("invite-result").getByRole("link").first().getAttribute("href");
  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await p2.goto(url!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
  await p2.goto("/reference");
  await expect(p2.getByTestId("qualification-summary")).toContainText("Minimum employees");
  await expect(p2.locator("#q-employees")).toHaveCount(0);
  await ctx.close();
});

test("the print view carries the brief but no qualification section", async ({ page }) => {
  await briefFor(page, "We want to roll out AI agents across the bureau.");
  const leadId = page.url().split("/").pop()!;
  await page.goto(`/print/leads/${leadId}`);
  await expect(page.getByRole("heading", { name: /Who they are/ })).toBeVisible();
  await expect(page.locator("#qualification")).toHaveCount(0);
  await expect(page.getByText("About 320 employees")).toHaveCount(0);
});
