import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

test("shows field errors, keeps input, and rejects non-http links", async ({ page }) => {
  await page.goto("/leads/new");
  await page.locator("#company").fill("Acme Ltd");
  await page.locator("#profileUrl").fill("javascript:alert(1)");
  await page.locator("#enquiryText").fill("We need an AI agent.");
  await page.getByRole("button", { name: "Save lead" }).click();

  await expect(page.getByText("First name is required")).toBeVisible();
  await expect(page.getByText("Enter a full link starting with https://")).toBeVisible();
  await expect(page.locator("#firstName")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#company")).toHaveValue("Acme Ltd");
  await expect(page.locator("#enquiryText")).toHaveValue("We need an AI agent.");
  await expectNoHorizontalOverflow(page);
});

test("creates a lead with a multilingual name and shows it everywhere", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const surname = `الحسن Ḥassan ${Date.now().toString(36)}`;

  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Hatem");
  await page.locator("#lastName").fill(surname);
  await page.locator("#company").fill("RSB Dubai");
  await page.locator("#jobTitle").fill("Head of Digital Transformation");
  await page.locator("#profileUrl").fill("https://www.linkedin.com/in/example");
  await page.locator("#email").fill("hatem@rsbdubai.gov.ae");
  await page.locator("#country").fill("United Arab Emirates");
  await page.locator("#enquiryText").fill("Line one\nLine two <b>not bold</b>");
  await page.getByRole("button", { name: "Save lead" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `Hatem ${surname}` })).toBeVisible();
  await expect(page.getByText("Line two <b>not bold</b>")).toBeVisible();
  const link = page.getByRole("link", { name: "https://www.linkedin.com/in/example" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expectNoHorizontalOverflow(page);

  await page.goto("/");
  await expect(page.getByRole("link", { name: new RegExp(surname) })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("a lead is private to the person who created it", async ({ page, browser }) => {
  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Private");
  await page.locator("#lastName").fill(`Lead ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Private Lead/ })).toBeVisible();
  const leadUrl = page.url();

  // Invite a second user and confirm they get a 404 for this lead.
  const member = `e2e-member-${Date.now().toString(36)}@example.com`;
  await page.goto("/team");
  await page.locator("#emails").fill(member);
  await page.getByRole("button", { name: "Send invitations" }).click();
  const url = await page.getByTestId("invite-result").getByRole("link").first().getAttribute("href");

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
  await p2.goto(leadUrl);
  await expect(p2.getByRole("heading", { name: "We could not find that" })).toBeVisible();
  await expect(p2.getByText(/Private Lead/)).toHaveCount(0);
  await ctx.close();
});

test("empty state invites the first lead", async ({ page, browser }) => {
  const member = `e2e-empty-${Date.now().toString(36)}@example.com`;
  await page.goto("/team");
  await page.locator("#emails").fill(member);
  await page.getByRole("button", { name: "Send invitations" }).click();
  const url = await page.getByTestId("invite-result").getByRole("link").first().getAttribute("href");

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await p2.goto(url!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByText("Start with a name")).toBeVisible();
  await p2.getByRole("link", { name: "Add your first lead" }).click();
  await expect(p2).toHaveURL(/\/leads\/new$/);
  await ctx.close();
});

test("a lead can be deleted after confirming", async ({ page }) => {
  const surname = `Delete ${Date.now().toString(36)}`;
  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Remove");
  await page.locator("#lastName").fill(surname);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Remove ${surname}` })).toBeVisible();

  await page.getByRole("button", { name: "Delete lead" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Remove ${surname}` })).toBeVisible();

  await page.getByRole("button", { name: "Delete lead" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: new RegExp(surname) })).toHaveCount(0);
});

test("the header quick search needs both names, then builds a brief without a review stop and reopens it next time", async ({ page }) => {
  const surname = `Quick ${Date.now().toString(36)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Quick brief search" }).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByLabel("First name")).toBeFocused();

  await page.getByLabel("First name").fill("Searchy");
  await page.getByLabel("Last name").fill(surname);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/\/leads\//);
  const leadUrl = page.url();
  await expect(page.getByRole("heading", { level: 1, name: `Searchy ${surname}` })).toBeVisible();
  // Never stops on the review card: it goes on to the brief, or asks who they are.
  await expect(page.getByTestId("brief").or(page.getByTestId("confirmation")).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("awaiting-approval")).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Quick brief search" }).click();
  await page.getByLabel("First name").fill("searchy");
  await page.getByLabel("Last name").fill(surname.toUpperCase());
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(leadUrl);
});
