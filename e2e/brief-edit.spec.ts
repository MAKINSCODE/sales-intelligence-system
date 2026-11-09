import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN } from "./db";
import { expectNoHorizontalOverflow, signIn } from "./helpers";

test.describe.configure({ timeout: 120_000 });

const hatem = { firstName: "Hatem", lastName: "Hassan", company: "RSB Dubai", email: "hatem.hassan@rsbdubai.gov.ae", enquiryText: "We want to roll out AI agents across the bureau." };

async function createLead(page: Page, fields: Record<string, string>) {
  await page.goto("/leads/new");
  for (const [id, value] of Object.entries(fields)) await page.locator(`#${id}`).fill(value);
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(fields.firstName);
}

// Skipping the review means the brief is built without ever stopping on the review card.
async function buildWithoutReview(page: Page, fields: Record<string, string> = hatem) {
  await createLead(page, fields);
  await page.getByRole("button", { name: "Generate brief" }).click();
  const them = page.getByRole("button", { name: "This is them" });
  const brief = page.getByTestId("brief");
  await expect(brief.or(them)).toBeVisible({ timeout: 90_000 });
  if (await them.isVisible()) await them.click();
  await expect(brief).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("awaiting-approval")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await signIn(page, E2E_ADMIN);
});

test("a brief can be built without the review stop, and carries no qualification section", async ({ page }) => {
  await buildWithoutReview(page);
  const rail = page.locator("aside");
  await expect(rail.getByTestId("lead-details")).toBeVisible();
  await expect(page.getByTestId("decision-final")).toHaveCount(0);
  await expect(page.locator("#qualification")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("skipping the review also researches a lead the rules would have stopped", async ({ page }) => {
  await buildWithoutReview(page, { ...hatem, email: "hatem@gmail.com" });
  await expect(page.getByTestId("brief")).toBeVisible();
  await expect(page.getByTestId("decision-final")).toHaveCount(0);
});

test("the company and title found online appear on the brief's header and on the list", async ({ page }) => {
  await buildWithoutReview(page, { firstName: "Hatem", lastName: "Hassan", profileUrl: "https://www.linkedin.com/in/hatem-hassan-rsb", enquiryText: hatem.enquiryText });
  await expect(page.getByTestId("lead-subtitle")).toContainText("Chief Executive at RSB Dubai", { timeout: 30_000 });
  await page.goto("/");
  await expect(page.getByRole("link").filter({ hasText: "Hatem Hassan" }).first()).toContainText("Chief Executive at RSB Dubai");
});

test("lead details can be corrected, and the correction shows on the page and the list", async ({ page }) => {
  await buildWithoutReview(page);
  const rail = page.locator("aside");
  await rail.getByRole("button", { name: "Edit", exact: true }).click();

  await rail.locator("#edit-email").fill("not-an-email");
  await rail.getByRole("button", { name: "Save details" }).click();
  await expect(rail.getByText("Enter a valid email address")).toBeVisible();

  await rail.locator("#edit-email").fill(hatem.email);
  await rail.locator("#edit-company").fill("Gulf Cooling");
  await rail.locator("#edit-jobTitle").fill("Head of Digital");
  await rail.getByRole("button", { name: "Save details" }).click();
  await expect(rail.getByTestId("lead-details")).toContainText("Gulf Cooling");
  await expect(rail).toContainText("Refresh the research to use the changes in the brief.");
  await expect(page.getByTestId("lead-subtitle")).toContainText("Head of Digital at Gulf Cooling");

  await page.goto("/");
  await expect(page.getByRole("link").filter({ hasText: "Hatem Hassan" }).first()).toContainText("Head of Digital at Gulf Cooling");
});

test("any item can be edited, restored to what it was, removed and brought back", async ({ page }) => {
  await buildWithoutReview(page);
  const now = page.locator("#now");

  const news = now.locator("li", { hasText: "district cooling regulation" }).first();
  await news.getByRole("button", { name: "Edit", exact: true }).click();
  await news.getByRole("textbox", { name: "Edit this item" }).fill("RSB Dubai announced a corrected regulation.");
  await news.getByRole("button", { name: "Save", exact: true }).click();
  const edited = now.locator("li", { hasText: "corrected regulation" });
  await expect(edited.getByTestId("edited-note")).toContainText("Originally: “RSB Dubai launched a new district cooling regulation");
  await page.reload();
  await expect(now.locator("li", { hasText: "corrected regulation" })).toBeVisible();

  await now.locator("li", { hasText: "corrected regulation" }).getByRole("button", { name: "Restore original" }).click();
  await expect(now.locator("li", { hasText: "corrected regulation" })).toHaveCount(0);
  await expect(now.locator("li", { hasText: "new district cooling regulation" })).toBeVisible();

  const review = now.locator("li", { hasText: "customer service review" });
  await review.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(now.getByText("customer service review")).toHaveCount(0);
  const removed = page.getByTestId("removed-items");
  await removed.getByText(/Removed items \(1\)/).click();
  await removed.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(now.locator("li", { hasText: "customer service review" })).toBeVisible();
  await expect(removed).toHaveCount(0);
});

test("the call plan has no opener or questions", async ({ page }) => {
  await buildWithoutReview(page);
  const plan = page.locator("#conversation");
  await expect(plan.getByText("Questions worth asking")).toHaveCount(0);
  await expect(plan.getByRole("button", { name: "Edit opener" })).toHaveCount(0);
  await expect(page.locator("#summary").getByText("Open with")).toHaveCount(0);
});

test("follow-up questions are answered from the brief, and a suggested change applies only when accepted", async ({ page }) => {
  await buildWithoutReview(page);
  const launcher = page.getByRole("button", { name: "Ask about this brief" });
  const chat = page.getByTestId("brief-chat");
  await expect(chat).toBeHidden();
  await launcher.click();
  await expect(chat).toBeVisible();

  await chat.getByRole("textbox", { name: "Your question" }).fill("Rewrite the angle to be sharper");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  const change = chat.getByTestId("chat-change");
  await expect(change).toContainText("Make the angle more direct", { timeout: 30_000 });
  await expect(page.locator("#conversation")).not.toContainText("Their operations are under pressure");

  await change.getByRole("button", { name: "Apply" }).click();
  await expect(page.locator("#conversation")).toContainText("Their operations are under pressure, and an agent can take on the repetitive load.");
  await expect(change).toContainText("Applied to the brief");

  await chat.getByRole("textbox", { name: "Your question" }).fill("Who is this person?");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.getByTestId("chat-assistant").last()).toContainText("Chief Executive at RSB Dubai", { timeout: 30_000 });

  await chat.getByRole("textbox", { name: "Your question" }).fill("What is their favourite food for dinner?");
  await chat.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(chat.getByTestId("chat-assistant").last()).toContainText("The brief does not say", { timeout: 30_000 });

  await page.reload();
  await page.getByRole("button", { name: "Ask about this brief" }).click();
  await expect(page.getByTestId("brief-chat").getByTestId("chat-user")).toHaveCount(3);
  await expect(page.getByTestId("brief-chat").getByTestId("chat-change")).toContainText("Applied to the brief");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("brief-chat")).toBeHidden();
});

test("the assistant asks who the brief is for, and switching teammate changes the fit and the other signals", async ({ page }) => {
  await buildWithoutReview(page);
  // Nobody was chosen, so the fit cannot be shown yet.
  await expect(page.locator("#fit")).toContainText("Choose who this brief is for");
  await expect(page.getByTestId("fit-with-you")).toHaveCount(0);
  await expect(page.getByTestId("fit-summary")).toHaveCount(0);

  await page.getByRole("button", { name: "Ask about this brief" }).click();
  const chat = page.getByTestId("brief-chat");
  await expect(chat.getByTestId("chat-assistant").first()).toContainText("Who is this brief for?");

  await chat.getByRole("radio", { name: "Piero Trivellato" }).click();
  await expect(chat.getByTestId("chat-assistant").last()).toContainText("now for Piero Trivellato", { timeout: 30_000 });
  await expect(page.getByTestId("fit-with-you")).toContainText("Piero Trivellato also studied at Osun State University");
  await expect(page.getByTestId("fit-summary")).toContainText("You also studied at Osun State University");
  await expect(page.getByTestId("other-signals")).toContainText("Azeez Busari also worked at Gulf Utilities");

  await chat.getByRole("radio", { name: "Azeez Busari" }).click();
  await expect(chat.getByTestId("chat-assistant").last()).toContainText("now for Azeez Busari", { timeout: 30_000 });
  await expect(page.getByTestId("fit-with-you")).toContainText("Azeez Busari also worked at Gulf Utilities");
  await expect(page.getByTestId("fit-with-you")).not.toContainText("Osun State University");
  await expect(page.getByTestId("fit-summary")).toContainText("You also worked at Gulf Utilities");
  await expect(page.getByTestId("other-signals")).toContainText("Piero Trivellato also studied at Osun State University");

  await page.reload();
  await expect(page.getByTestId("fit-with-you")).toContainText("Azeez Busari also worked at Gulf Utilities");
});
