import { expect, test, type Page, type Request } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, proceed, signIn } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

const isServerAction = (r: Request) => r.method() === "POST" && "next-action" in r.headers();

async function fillLead(page: Page) {
  await page.goto("/leads/new");
  await page.locator("#firstName").fill("Hatem");
  await page.locator("#lastName").fill("Hassan");
  await page.locator("#company").fill("RSB Dubai");
  await page.locator("#email").fill("hatem.hassan@rsbdubai.gov.ae");
  await page.locator("#enquiryText").fill("We want AI agents for the bureau.");
}

async function saveLead(page: Page) {
  await fillLead(page);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hatem");
}

test("research carries on and the page recovers when the connection to the server drops", async ({ page }) => {
  await saveLead(page);
  let blocked = false;
  await page.route("**/api/leads/*/run", (route) => (blocked ? route.abort("connectionfailed") : route.continue()));

  blocked = true;
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("brief-panel")).toBeVisible();
  await expect(page.getByTestId("connection-notice")).toContainText("Having trouble reaching the server", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  blocked = false;
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
});

test("going offline is explained, and the page catches up as soon as the network returns", async ({ page, context }) => {
  await saveLead(page);
  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByTestId("brief-panel")).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByTestId("connection-notice")).toContainText("You are offline", { timeout: 30_000 });

  await context.setOffline(false);
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("connection-notice")).toHaveCount(0);
});

test("a Generate click lost on the network gives a clear message, and trying again works", async ({ page }) => {
  await saveLead(page);
  await page.route("**/leads/**", (route) => (isServerAction(route.request()) ? route.abort("failed") : route.continue()));

  await page.getByRole("button", { name: "Review lead first" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "did not go through" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review lead first" })).toBeEnabled();
  await expect(page.getByText("Application error")).toHaveCount(0);

  await page.unroute("**/leads/**");
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
});

test("a lead that fails to save over a bad connection keeps everything that was typed", async ({ page }) => {
  await fillLead(page);
  await page.locator("#enquiryText").fill("We need help with our executive reporting.");
  await page.route("**/leads/new", (route) => (isServerAction(route.request()) ? route.abort("failed") : route.continue()));

  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toBeVisible();
  await expect(page.locator("#firstName")).toHaveValue("Hatem");
  await expect(page.locator("#company")).toHaveValue("RSB Dubai");
  await expect(page.locator("#enquiryText")).toHaveValue("We need help with our executive reporting.");

  await page.unroute("**/leads/new");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hatem");
});

test("pasted control characters do not break saving a lead", async ({ page }) => {
  await fillLead(page);
  await page.locator("#company").fill("RSB\u0007 Dubai");
  await page.locator("#notes").fill("Met at the summit\u0007");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Hatem");
  await expect(page.getByText("RSB Dubai").first()).toBeVisible();
});

test("a PDF download that fails on the network says so and can be retried", async ({ page }) => {
  await saveLead(page);
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });

  await page.route("**/api/leads/*/pdf", (route) => route.abort("connectionreset"));
  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be downloaded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" })).toBeEnabled();

  await page.unroute("**/api/leads/*/pdf");
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Export PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^Brief - .*\.pdf$/);
});

test("a busy PDF service asks the person to wait rather than failing silently", async ({ page }) => {
  await saveLead(page);
  await page.getByRole("button", { name: "Review lead first" }).click();
  await proceed(page);
  await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
  await page.route("**/api/leads/*/pdf", (route) => route.fulfill({ status: 503, headers: { "Retry-After": "10" }, contentType: "application/json", body: JSON.stringify({ error: "Several PDFs are being prepared right now. Please try again in a moment." }) }));
  await page.getByRole("button", { name: "Export PDF" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "try again in a moment" })).toBeVisible();
});

test.describe("a reader on the other side of the world", () => {
  test.use({ timezoneId: "Pacific/Auckland" });

  test("times are shown in the reader's own time zone, with no hydration errors", async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await saveLead(page);
    await page.getByRole("button", { name: "Review lead first" }).click();
    await proceed(page);
    await expect(page.getByTestId("brief")).toBeVisible({ timeout: 60_000 });
    await page.reload();

    const prepared = page.getByTestId("brief").locator("time").first();
    await expect(prepared).toBeVisible();
    const iso = await prepared.getAttribute("datetime");
    const expected = new Date(iso!).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Pacific/Auckland" });
    await expect(prepared).toHaveText(expected);
    await expect(prepared).not.toContainText("UTC");

    const added = page.locator("main time").first();
    await expect(added).toBeVisible();
    expect(errors).toEqual([]);
  });
});
