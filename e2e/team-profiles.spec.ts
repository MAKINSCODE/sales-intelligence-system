import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, signIn, uniqueEmail } from "./helpers";

test.describe.configure({ timeout: 90_000 });

const list = (page: Page) => page.getByTestId("team-profile-list");

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
  await page.goto("/reference");
  await expect(page.getByRole("heading", { name: "Team LinkedIn profiles" })).toBeVisible();
});

test("an admin adds a profile, it is read in the background, and removing it takes it off the list", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await expect(list(page).getByTestId("team-profile-piero-trivellato")).toContainText("Piero Trivellato");

  await page.locator("#team-urls").fill("https://www.linkedin.com/in/olumide-soyombo/");
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByTestId("team-add-result")).toContainText("Added 1");

  const row = list(page).getByTestId("team-profile-olumide-soyombo");
  await expect(row).toBeVisible();
  // The worker reads it within seconds and the page refreshes itself.
  await expect(row).toContainText("Olumide Soyombo", { timeout: 40_000 });
  await expect(row).toContainText("Up to date");
  await expectNoHorizontalOverflow(page);

  await row.getByRole("button", { name: /^Remove/ }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(list(page).getByTestId("team-profile-olumide-soyombo")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("addresses that are not LinkedIn profiles are rejected, duplicates are not added twice", async ({ page }) => {
  await page.locator("#team-urls").fill("https://example.com/in/someone");
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "None of those are LinkedIn profile addresses" })).toBeVisible();

  await page.locator("#team-urls").fill("linkedin.com/in/Piero-Trivellato/");
  await page.getByRole("button", { name: "Add to team" }).click();
  await expect(page.getByTestId("team-add-result")).toContainText("Already on the team: 1");
  await expect(list(page).getByTestId("team-profile-piero-trivellato")).toHaveCount(1);
});

test("a profile that cannot be read says so and can be removed", async ({ page }) => {
  await page.locator("#team-urls").fill("https://www.linkedin.com/in/missing-person");
  await page.getByRole("button", { name: "Add to team" }).click();
  const row = list(page).getByTestId("team-profile-missing-person");
  await expect(row).toContainText("Failed", { timeout: 40_000 });
  await expect(row.getByRole("alert")).toContainText("No profile data was returned");
  await row.getByRole("button", { name: /^Remove/ }).click();
  await expect(row).toHaveCount(0);
});

test("members can see the team list but cannot change it", async ({ page, browser }) => {
  const member = uniqueEmail("teamview");
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
  await expect(p2.getByTestId("team-profile-piero-trivellato")).toContainText("Piero Trivellato");
  await expect(p2.locator("#team-urls")).toHaveCount(0);
  await expect(p2.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
  await expect(p2.getByRole("button", { name: /^Refresh/ })).toHaveCount(0);
  await ctx.close();
});
