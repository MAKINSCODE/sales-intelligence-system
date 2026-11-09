import { expect, test } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { collectConsoleErrors, expectNoHorizontalOverflow, signIn } from "./helpers";

test("every page fits the viewport and logs no console errors", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await signIn(page, E2E_ADMIN);

  for (const [path, ready] of [
    ["/", page.getByRole("heading", { name: "Briefs", level: 1 })],
    ["/leads/new", page.locator("#firstName")],
    ["/team", page.locator("li[data-testid^=member-]").first()],
    ["/reference", page.getByRole("heading", { name: "Reference", level: 1 })],
  ] as const) {
    await page.goto(path);
    await expect(ready).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test("navigation adapts to the viewport", async ({ page, isMobile }, info) => {
  await signIn(page, E2E_ADMIN);
  const mobile = info.project.name === "mobile";
  const bottomNav = page.locator("nav[aria-label=Primary]").last();
  const headerCta = page.locator("header").getByRole("link", { name: "New brief" });

  if (mobile) {
    await expect(bottomNav).toBeVisible();
    await expect(page.getByRole("link", { name: "New brief" }).and(page.locator("nav a"))).toBeVisible();
    await expect(headerCta).toBeHidden();
  } else {
    await expect(page.locator("header nav[aria-label=Primary]")).toBeVisible();
    await expect(headerCta).toBeVisible();
    await expect(page.locator("nav.fixed")).toBeHidden();
  }
  void isMobile;
});

test("primary tap targets are at least 44px on mobile", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  await signIn(page, E2E_ADMIN);
  await page.goto("/leads/new");
  for (const loc of [page.locator("#firstName"), page.getByRole("button", { name: "Save lead" })]) {
    await expect(loc).toBeVisible();
    const box = await loc.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.9);
  }
});
