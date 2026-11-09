import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { E2E_ADMIN, seedSurnamelessLead } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, proceed, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 90_000 });

async function createLead(page: Page, fields: Record<string, string>) {
  await page.goto("/leads/new");
  for (const [id, value] of Object.entries(fields)) await page.locator(`#${id}`).fill(value);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fields.firstName);
}

async function setupReferences(page: Page) {
  await page.goto("/reference");
  await page.locator("#catalogue-file").setInputFiles("docs/our_company.yaml");
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Imported version|already active/ })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

// Every lead waits for the person's decision on the review card before the brief is built.
const approve = proceed;

test("a clear match produces a sourced five-section brief, with honest labels and no invented LinkedIn posts", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await setupReferences(page);
  await createLead(page, {
    firstName: "Hatem",
    lastName: "Hassan",
    company: "RSB Dubai",
    email: "hatem.hassan@rsbdubai.gov.ae",
    enquiryText: "We want an AI agent to support our operational and executive functions across the bureau.",
  });

  await page.locator("#brief-for").selectOption({ label: "Piero Trivellato" });
  await page.getByRole("button", { name: "Review lead first" }).click();
  const panel = page.getByTestId("brief-panel");
  await expect(panel).toHaveAttribute("data-status", /QUALIFYING|IDENTIFYING|RESEARCHING|WRITING|QUEUED|AWAITING_APPROVAL/);
  await expect(page.getByTestId("awaiting-approval")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("review-status")).toContainText("Qualified");
  await expect(page.getByTestId("brief")).toHaveCount(0);
  await approve(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });

  // A: who they are, verified with evidence
  await expect(page.getByRole("heading", { name: "Who they are" })).toBeVisible();
  await expect(page.getByText("Chief Executive at RSB Dubai").first()).toBeVisible();
  const role = page.locator("li", { hasText: "Chief Executive at RSB Dubai" }).first();
  await expect(role.getByText("Verified")).toBeVisible();
  await role.getByText("Evidence", { exact: true }).click();
  await expect(role.getByText("is the Chief Executive of RSB Dubai")).toBeVisible();
  await expect(role.getByRole("link", { name: /Hatem Hassan/ })).toHaveAttribute("href", /rsbdubai\.gov\.ae/);
  await expect(role).toContainText("publication date not stated");

  // B: fit with the person the brief is for: only specific ties, short, never confirmed
  // The summary carries the strongest ties, specific to what they share and when, not a general line
  const summaryFit = page.getByTestId("fit-summary");
  await expect(summaryFit).toContainText("You also studied at Osun State University");
  await expect(summaryFit).toContainText("Them: 2022 to 2024. You: 2021 to 2025");
  await expect(summaryFit).not.toContainText("Gulf Utilities");
  const fit = page.getByTestId("fit-with-you");
  await expect(fit).toContainText("Piero Trivellato also studied at Osun State University");
  await expect(fit).not.toContainText("Gulf Utilities");
  await expect(page.getByTestId("common-ground")).toHaveCount(0);
  // Lighter overlaps with the rest of the team
  await expect(page.getByTestId("other-signals")).toContainText("Azeez Busari also worked at Gulf Utilities");
  await expect(page.getByTestId("other-signals")).not.toContainText("Piero Trivellato");

  // No qualification section, opener or questions on the finished brief
  await expect(page.getByTestId("decision-final")).toHaveCount(0);
  await expect(page.getByTestId("qualification-rules")).toHaveCount(0);

  // C: dated news plus what the lead said, labelled as provided
  await expect(page.getByText(/district cooling regulation/).first()).toBeVisible();
  await expect(page.locator("#now").getByText("10 Mar 2026", { exact: true })).toHaveCount(2);
  await expect(page.getByText("Stated by the lead in their enquiry")).toBeVisible();

  // D: no profile link was given, so nothing is guessed or invented
  await expect(page.getByRole("heading", { name: "Latest LinkedIn activity" })).toBeVisible();
  await expect(page.locator("#activity").getByText(/No confirmed LinkedIn profile link/)).toBeVisible();
  await expect(page.locator("#activity").getByText("Collected", { exact: true })).toHaveCount(0);

  // E: grounded call plan only, approved solution, no fabricated claim
  await expect(page.getByTestId("angle")).toBeVisible();
  await expect(page.getByText("Stated by the lead", { exact: true })).toBeVisible();
  await expect(page.getByText(/Jada fit: /).first()).toBeVisible();
  await expect(page.getByText("made-up claim")).toHaveCount(0);
  await expect(page.getByText("Questions worth asking")).toHaveCount(0);

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);

  // Rating persists
  await page.getByRole("radio", { name: "4 out of 5" }).click();
  await page.getByLabel("Rating note").fill("Useful opener");
  await page.getByRole("button", { name: "Save rating" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: "4 out of 5" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Rating note")).toHaveValue("Useful opener");
});

test("two people share the name: nothing is written until you choose, and only the chosen person is used", async ({ page }) => {
  await createLead(page, { firstName: "Sam", lastName: "Ambiguous" });
  await page.getByRole("button", { name: "Review lead first" }).click();

  await expect(page.getByTestId("confirmation")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("candidate")).toHaveCount(2);
  await expect(page.getByTestId("brief")).toHaveCount(0);

  await page.getByTestId("candidate").filter({ hasText: "Northwind" }).getByRole("button", { name: "This is them" }).click();
  await approve(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Finance Director at Northwind Traders").first()).toBeVisible();
  await expect(page.getByText("Contoso")).toHaveCount(0);
});

test("when nobody can be confirmed you can continue with company information only", async ({ page }) => {
  await createLead(page, { firstName: "Nobody", lastName: "Found", company: "RSB Dubai", email: "it@rsbdubai.gov.ae" });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("confirmation")).toContainText("could not confirm", { timeout: 60_000 });
  await page.getByRole("button", { name: /continue with company information only/i }).click();
  await approve(page);

  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Company information only")).toBeVisible();
  await expect(page.getByText(/No career details could be verified/)).toBeVisible();
  await expect(page.getByText(/district cooling regulation/).first()).toBeVisible();
});

test("a lead with no surname gets a company-only brief, never a made-up person", async ({ page }) => {
  await page.goto(`/leads/${await seedSurnamelessLead({ firstName: "Jamaica", email: "it@rsbdubai.gov.ae", enquiryText: "We are looking for an AI agent assistant for our CEO and company, with voice and text support and Microsoft 365 integration." })}`);
  await page.getByRole("button", { name: "Review lead first" }).click();
  const confirm = page.getByTestId("confirmation");
  await expect(confirm).toContainText("Only a first name was provided", { timeout: 60_000 });
  await expect(confirm.getByTestId("candidate")).toHaveCount(0);
  await confirm.getByRole("button", { name: /continue with company information only/i }).click();
  await approve(page);

  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Company information only")).toBeVisible();
  await expect(page.getByText(/No career details could be verified/)).toBeVisible();
  await expect(page.getByText("Stated by the lead", { exact: true })).toBeVisible();
  await expect(page.getByText(/district cooling regulation/).first()).toBeVisible();
});

test("a lead with nothing to research explains what to add instead of offering an empty brief", async ({ page }) => {
  await page.goto(`/leads/${await seedSurnamelessLead({ firstName: "Pat", email: "pat@gmail.com" })}`);
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("screened-out")).toContainText("personal email address", { timeout: 60_000 });
  await page.getByRole("button", { name: "Research anyway" }).click();
  const confirm = page.getByTestId("confirmation");
  await expect(confirm).toContainText("Only a first name was provided", { timeout: 60_000 });
  await expect(confirm.getByRole("button", { name: /company information only/i })).toHaveCount(0);
  await expect(confirm).toContainText("no company, work email or enquiry");
});

test("a failing analysis step yields a clearly labelled partial brief", async ({ page }) => {
  await createLead(page, { firstName: "Fail", lastName: "Case", company: "Acme" });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("confirmation")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("candidate").first().getByRole("button", { name: "This is them" }).click();
  await approve(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Partial brief")).toBeVisible();
  await expect(page.getByText("Some parts are incomplete")).toBeVisible();
  await expect(page.getByText(/Could not finish extracting career details/)).toBeVisible();
});

test("research can be stopped, and then restarted", async ({ page }) => {
  await createLead(page, { firstName: "Slow", lastName: "Poke", company: "RSB Dubai", email: "s.poke@rsbdubai.gov.ae", enquiryText: "We want AI agents." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Research stopped")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("brief")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("brief-panel")).not.toHaveAttribute("data-status", "CANCELLED");
});

test("a member needs no CV: their brief is compared with the shared team profiles", async ({ page, browser }) => {
  const member = uniqueEmail("bare");
  await page.goto("/team");
  await page.locator("#emails").fill(member);
  await page.getByRole("button", { name: "Send invitations" }).click();
  const link = await page.getByTestId("invite-result").getByRole("link").first().getAttribute("href");

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p = await ctx.newPage();
  await p.goto(link!);
  await p.getByRole("button", { name: "Continue" }).click();
  await expect(p.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
  await createLead(p, { firstName: "Hatem", lastName: "Hassan", company: "RSB Dubai", email: "hatem.hassan@rsbdubai.gov.ae", enquiryText: "We want AI agents for the bureau." });
  await expect(p.getByText("2 team LinkedIn profiles will be used")).toBeVisible();
  await p.getByRole("button", { name: "Review lead first" }).click();
  await approve(p);
  await expect(p.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(p.getByText("Piero Trivellato also studied at Osun State University").first()).toBeVisible();
  await ctx.close();
});

test("a brief belongs to its owner only", async ({ page, browser }) => {
  await createLead(page, { firstName: "Hatem", lastName: "Hassan", company: "RSB Dubai", email: "h@rsbdubai.gov.ae", enquiryText: "We want AI agents for the bureau." });
  await page.getByRole("button", { name: "Review lead first" }).click();
  await approve(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  const leadId = page.url().split("/").pop()!;

  const unauth = await browser.newContext();
  const res = await unauth.request.get(`/api/leads/${leadId}/run`);
  expect(res.status()).toBe(401);
  await unauth.close();

  const own = await page.evaluate(async (id) => (await fetch(`/api/leads/${id}/run`)).status, leadId);
  expect(own).toBe(200);
});

test("the Jada profile used in testing is the real approved file", () => {
  expect(readFileSync("docs/our_company.yaml", "utf8")).toMatch(/^approved: true/m);
});
