import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, requestLink, signIn } from "./helpers";

test("signed-out visitors are redirected to sign in", async ({ page }) => {
  for (const path of ["/", "/team", "/leads/new", "/reference"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("rejects an invalid email without sending a link", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("not-an-email");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "valid email" })).toBeVisible();
});

test("unknown addresses get the same response and no link", async ({ page }) => {
  await requestLink(page, "e2e-stranger@example.com");
  await expect(page.getByTestId("dev-link")).toHaveCount(0);
});

test("sign in with a one-time link, then sign out", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await requestLink(page, E2E_ADMIN);
  const link = await page.getByTestId("dev-link").getAttribute("href");

  await page.goto(link!);
  await expect(page.getByText(`Continue as ${E2E_ADMIN}`)).toBeVisible();
  // Opening the link alone must not sign in (protects against email link scanners).
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(link!);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("a sign-in link works only once", async ({ page, browser }) => {
  await requestLink(page, E2E_ADMIN);
  const link = (await page.getByTestId("dev-link").getAttribute("href"))!;

  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(link);
  await expect(p2.getByRole("heading", { name: "Link expired" })).toBeVisible();
  await other.close();
});

test("a tampered link is rejected", async ({ page }) => {
  await page.goto("/auth/verify?token=not-a-real-token");
  await expect(page.getByRole("heading", { name: "Link expired" })).toBeVisible();
  await page.getByRole("link", { name: "Request a new link" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("sign-in form shows pending state and is usable", async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  await expect(page.getByRole("link", { name: "Team" }).first()).toBeVisible();
});

test("repeated link requests are rate limited", async ({ page }) => {
  await requestLink(page, E2E_ADMIN);
  await expect(page.getByTestId("dev-link")).toBeVisible();
  for (let i = 0; i < 4; i++) await requestLink(page, E2E_ADMIN, { keepRateLimit: true });
  await expect(page.getByTestId("dev-link")).toBeVisible();
  await requestLink(page, E2E_ADMIN, { keepRateLimit: true });
  await expect(page.getByTestId("dev-link")).toHaveCount(0);
  await expect(page.getByText("If this email has access")).toBeVisible();
});
