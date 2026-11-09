import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, signIn, uniqueEmail } from "./helpers";

const yaml = readFileSync("docs/our_company.yaml", "utf8");

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  await page.goto("/reference");
  await expect(page.getByRole("heading", { name: "Jada profile and solutions" })).toBeVisible();
});

test("an admin imports the approved profile and sees what is usable and held back", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.locator("#catalogue-file").setInputFiles("docs/our_company.yaml");
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Imported version|already active/ })).toBeVisible();

  const summary = page.getByTestId("catalogue-summary");
  await expect(summary).toContainText("approved by Jamiu Jimoh");
  await expect(summary).toContainText("reported by Jada");
  await summary.getByText("Agents delivered").click();
  await expect(summary.getByText("SalesPro AI Agent")).toBeVisible();
  await expect(summary.getByText("Held back until the owner confirms")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("an unapproved profile is rejected", async ({ page }) => {
  await page.locator("#catalogue-file").setInputFiles({
    name: "unapproved.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(yaml.replace(/^approved: true/m, "approved: false")),
  });
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "not approved" })).toBeVisible();
});

test("an approval with no named approver is rejected", async ({ page }) => {
  await page.locator("#catalogue-text").fill(yaml.replace(/^approved_by: .*$/m, "approved_by: null"));
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "approved_by" })).toBeVisible();
});

test("broken YAML and empty submissions give clear errors", async ({ page }) => {
  await page.locator("#catalogue-text").fill("a: [unclosed");
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Not valid YAML" })).toBeVisible();

  await page.locator("#catalogue-text").fill("");
  await page.getByRole("button", { name: "Import profile" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choose a YAML file" })).toBeVisible();
});

test("members can read the profile but cannot import", async ({ page, browser }) => {
  const member = uniqueEmail("cat");
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
  await expect(p2.getByRole("heading", { name: "Jada profile and solutions" })).toBeVisible();
  await expect(p2.locator("#catalogue-file")).toHaveCount(0);
  await ctx.close();
});
