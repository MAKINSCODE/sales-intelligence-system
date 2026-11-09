import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, signIn, uniqueEmail } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

async function invite(page: import("@playwright/test").Page, emails: string, role?: "ADMIN") {
  await page.goto("/team");
  await page.locator("#emails").fill(emails);
  if (role) await page.getByLabel("Admin").check();
  await page.getByRole("button", { name: "Send invitations" }).click();
  return page.getByTestId("invite-result");
}

test("bulk invite reports invited, duplicate, existing and invalid addresses", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const a = uniqueEmail("a");
  const b = uniqueEmail("b");

  const result = await invite(page, `${a}, ${b.toUpperCase()}\n${a}  not-an-email ${E2E_ADMIN}`);
  await expect(result).toContainText(`Invited: ${a}, ${b}`);
  await expect(result).toContainText(`Already have access: ${E2E_ADMIN}`);
  await expect(result).toContainText("Not valid email addresses: not-an-email");
  await expect(page.getByTestId(`member-${a}`)).toBeVisible();
  await expect(page.getByTestId(`member-${b}`)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("empty submission is rejected", async ({ page }) => {
  await page.goto("/team");
  await page.locator("#emails").fill("   ");
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter at least one email" })).toBeVisible();
});

test("members cannot reach the team page or see its navigation", async ({ page, browser }) => {
  const member = uniqueEmail("member");
  const result = await invite(page, member);
  const url = await result.getByRole("link").first().getAttribute("href");

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await p2.goto(url!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
  await expect(p2.getByRole("link", { name: "Team" })).toHaveCount(0);
  await p2.goto("/team");
  await expect(p2).toHaveURL(/\/$/);
  await ctx.close();
});

test("revoking access ends the person's session immediately and blocks new links", async ({ page, browser }) => {
  const member = uniqueEmail("revoke");
  const result = await invite(page, member);
  const url = await result.getByRole("link").first().getAttribute("href");

  const ctx = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const p2 = await ctx.newPage();
  await p2.goto(url!);
  await p2.getByRole("button", { name: "Continue" }).click();
  await expect(p2.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();

  const row = page.getByTestId(`member-${member}`);
  await page.reload();
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row.getByText("Revoked", { exact: true })).toBeVisible();

  await p2.reload();
  await expect(p2).toHaveURL(/\/login$/);
  await p2.locator("#email").fill(member);
  await p2.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(p2.getByText("If this email has access")).toBeVisible();
  await expect(p2.getByTestId("dev-link")).toHaveCount(0);

  // Restoring access lets them sign in again.
  await row.getByRole("button", { name: "Restore" }).click();
  await expect(row.getByText("Invited", { exact: true }).or(row.getByText("Active", { exact: true }))).toBeVisible();
  await p2.goto("/login");
  await p2.locator("#email").fill(member);
  await p2.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(p2.getByTestId("dev-link")).toBeVisible();
  await ctx.close();
});

test("an admin cannot revoke or demote themselves", async ({ page }) => {
  await page.goto("/team");
  const me = page.getByTestId(`member-${E2E_ADMIN}`);
  await expect(me).toBeVisible();
  await expect(me.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  await expect(me.getByRole("button", { name: "Make member" })).toHaveCount(0);
});

test("promote and demote a member", async ({ page }) => {
  const member = uniqueEmail("role");
  await invite(page, member);
  const row = page.getByTestId(`member-${member}`);
  await row.getByRole("button", { name: "Make admin" }).click();
  await expect(row.getByRole("button", { name: "Make member" })).toBeVisible();
  await row.getByRole("button", { name: "Make member" }).click();
  await expect(row.getByRole("button", { name: "Make admin" })).toBeVisible();
});
