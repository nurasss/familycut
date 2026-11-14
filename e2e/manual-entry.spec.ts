import { expect, test } from "@playwright/test";

test("FR-02: ten manual expenses can be added, corrected, removed and restored on reload", async ({ page }) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Add manually", exact: true }).click();

  for (let i = 1; i <= 10; i += 1) {
    await page.locator("#manual-merchant").fill(`Household service ${i}`);
    await page.locator("#manual-price").fill(`${i}.01`);
    await page.locator("#manual-frequency").selectOption("monthly");
    await page.locator("#manual-category").selectOption("Utilities");
    await page.getByRole("button", { name: "Add expense", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Your manual list (10)" })).toBeVisible();

  const firstRow = page.getByRole("listitem").filter({ has: page.getByLabel("Merchant or service", { exact: true }) }).first();
  await firstRow.getByLabel("Merchant or service").fill("Corrected household service");
  await firstRow.getByLabel("Price ($)", { exact: true }).fill("12.34");
  await firstRow.getByLabel("Category", { exact: true }).selectOption("Software");
  await page.getByRole("button", { name: "Remove Household service 10", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your manual list (9)" })).toBeVisible();

  await page.reload();
  await page.getByRole("tab", { name: "Add manually", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your manual list (9)" })).toBeVisible();
  const corrected = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Remove Corrected household service", exact: true }) });
  await expect(corrected.getByLabel("Price ($)", { exact: true })).toHaveValue("12.34");
  await expect(corrected.getByLabel("Category", { exact: true })).toHaveValue("Software");
  await expect(corrected.getByLabel("Frequency", { exact: true })).toHaveValue("monthly");

  await page.getByRole("button", { name: "Analyze expenses (9)", exact: true }).click();
  await expect(page).toHaveURL(/\/results$/);
  // 12.34 + (2.01 + ... + 9.01) = 56.42 per month; no decisions imply no planned savings.
  await expect(page.getByText("$677.04", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$0.00", { exact: true }).first()).toBeVisible();
});
