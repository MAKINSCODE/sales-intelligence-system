import { expect, type Page } from "@playwright/test";
import { resetLoginTokens } from "./db";

export const uniqueEmail = (label: string) =>
  `e2e-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

export async function requestLink(page: Page, email: string, { keepRateLimit = false } = {}) {
  if (!keepRateLimit) await resetLoginTokens(email);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByText("If this email has access")).toBeVisible();
}

export async function signIn(page: Page, email: string) {
  await requestLink(page, email);
  await page.getByTestId("dev-link").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Briefs", level: 1 })).toBeVisible();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, "page scrolls horizontally").toBe(false);
}

export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    // The host machine switching networks mid-run is not an application error.
    if (m.type() === "error" && !m.text().includes("ERR_NETWORK_CHANGED")) errors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  return errors;
}

// Every lead stops at the review card after the checks; this plays the person choosing to build the brief.
export async function proceed(page: Page) {
  await page.getByTestId("awaiting-approval").getByRole("button", { name: /^Proceed (to brief|anyway)$/ }).click({ timeout: 90_000 });
}
