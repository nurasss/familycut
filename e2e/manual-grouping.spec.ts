import { expect, test, type Page } from "@playwright/test";

const VALID_NETFLIX_CSV = [
  "Date,Description,Amount",
  "2026-08-03,NETFLIX.COM 8844,-15.49",
  "2026-09-03,NETFLIX.COM 8844,-15.49",
  "2026-10-03,NETFLIX.COM 8844,-15.49",
].join("\n");

const VALID_SPOTIFY_CSV = [
  "Date,Description,Amount",
  "2026-08-05,SPOTIFY USA,-11.99",
  "2026-09-05,SPOTIFY USA,-11.99",
  "2026-10-05,SPOTIFY USA,-11.99",
].join("\n");

async function uploadCsvText(
  page: Page,
  name: string,
  content: string,
): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(content, "utf8"),
  });
}

async function selectLineCheckboxes(
  page: Page,
  lineNumbers: readonly number[],
): Promise<void> {
  for (const line of lineNumbers) {
    const checkbox = page.getByRole("checkbox", {
      name: new RegExp(`^Select line ${line}:`),
    });
    await expect(checkbox).toBeVisible();
    await checkbox.check();
  }
}

async function mockAiEndpoint(page: Page) {
  const capturedPayloads: Record<string, unknown>[] = [];
  await page.route("**/api/ai/action", async (route) => {
    const req = route.request();
    const raw = req.postData();
    if (raw) {
      capturedPayloads.push(JSON.parse(raw) as Record<string, unknown>);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: "Cancel subscription request",
        body: "Please cancel my subscription effective immediately.",
        callScript: "Hello, I would like to cancel my recurring plan.",
        steps: ["Open billing settings", "Confirm cancellation email"],
        limitations: ["Review details before sending."],
        source: "fallback",
      }),
    });
  });
  return capturedPayloads;
}

test("1. Split separates identical no-ID Netflix accounts ($371.76/yr), surfaces op errors, skips non-debits, supports Undo/Clear and >12 rows", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  // Includes duplicate-day Netflix pair plus non-debit rows (refund, credit)
  const csv = [
    "Date,Description,Amount",
    "2026-08-03,NETFLIX.COM 8844,-15.49",
    "2026-08-03,NETFLIX.COM 8844,-15.49",
    "2026-09-03,NETFLIX.COM 8844,-15.49",
    "2026-09-03,NETFLIX.COM 8844,-15.49",
    "2026-10-03,NETFLIX.COM 8844,-15.49",
    "2026-10-03,NETFLIX.COM 8844,-15.49",
    "2026-10-10,NETFLIX REFUND,15.49",
    "2026-10-12,PAYROLL CREDIT,500.00",
  ].join("\n");

  await uploadCsvText(page, "netflix-dual.csv", csv);
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(page.getByText("$185.88/yr")).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze expenses (1)" }),
  ).toBeEnabled();

  // Refund & credit rows (Lines 8 and 9) must not offer selection checkboxes
  await expect(
    page.getByRole("checkbox", { name: /^Select line 8:/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: /^Select line 9:/ }),
  ).toHaveCount(0);

  const csvPanel = page.getByRole("tabpanel", { name: "Upload CSV" });

  // Error surfacing from applyGroupOp without disabling buttons
  await page.getByRole("button", { name: "Split selected" }).click();
  await expect(csvPanel.getByRole("alert")).toContainText(
    "Select at least one row",
  );

  await selectLineCheckboxes(page, [3]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(csvPanel.getByRole("alert")).toContainText(
    "Select at least 2 rows",
  );

  // Split alternating duplicate lines (Lines 3, 5, 7 -> rawIndices 1, 3, 5)
  await selectLineCheckboxes(page, [5, 7]);
  await page.getByRole("button", { name: "Split selected" }).click();

  await expect(page.getByText("2 recurring candidates detected")).toBeVisible();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Separated by you: treated as its own service"),
  ).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Analyze expenses (2)" }),
  ).toBeEnabled();

  // Undo restores 1 candidate ($185.88/yr + duplicate hint), Clear resets all grouping
  await page.getByRole("button", { name: /Undo grouping/ }).click();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(page.getByText("$185.88/yr")).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toBeVisible();

  await selectLineCheckboxes(page, [3, 5, 7]);
  await page.getByRole("button", { name: "Split selected" }).click();
  await expect(page.getByText("2 recurring candidates detected")).toBeVisible();
  await page.getByRole("button", { name: "Clear all grouping" }).click();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(page.getByText("$185.88/yr")).toBeVisible();
  await expect(page.getByText("Possible duplicate")).toBeVisible();

  // Re-split and Analyze -> /results shows $371.76 recurring spend
  await selectLineCheckboxes(page, [3, 5, 7]);
  await page.getByRole("button", { name: "Split selected" }).click();
  await page.getByRole("button", { name: "Analyze expenses (2)" }).click();

  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("$371.76", { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .getByText(/Separated by you: treated as its own service/),
  ).toBeVisible();

  // Rows beyond index 12 are selectable and groupable when expanded
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  const manyRowsCsv = [
    "Date,Description,Amount",
    "2026-01-02,ALPHA COFFEE,-5.00",
    "2026-01-03,BRAVO BAKERY,-6.00",
    "2026-01-04,CHARLIE DELI,-7.00",
    "2026-01-05,DELTA BOOKS,-8.00",
    "2026-01-06,ECHO HARDWARE,-9.00",
    "2026-01-07,FOXTROT PHARMACY,-10.00",
    "2026-01-08,GOLF RANGE,-11.00",
    "2026-01-09,HOTEL SNACKS,-12.00",
    "2026-01-10,INDIA MARKET,-13.00",
    "2026-01-11,JULIET FLORIST,-14.00",
    "2026-01-12,KILO PETS,-15.00",
    "2026-01-13,LIMA STATIONERY,-16.00",
    "2026-08-05,HULU STREAMING,-14.99",
    "2026-09-05,CLOUD BACKUP,-14.99",
    "2026-10-05,DIGITAL PASS,-14.99",
  ].join("\n");
  await uploadCsvText(page, "many-rows.csv", manyRowsCsv);
  await page.getByRole("button", { name: "Show all 15 rows" }).click();
  await selectLineCheckboxes(page, [14, 15, 16]);
  await page
    .getByLabel("Optional service name")
    .fill("Long List Bundle");
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Detected recurring expenses (1)" }),
  ).toBeVisible();
  await expect(
    page.getByText("Long List Bundle", { exact: true }).first(),
  ).toBeVisible();
});

test("2. Merge combines gapped Netflix ($185.88/yr) and preserves dropped multi-name NFLX fragment", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  const gappedCsv = [
    "Date,Description,Amount,Transaction ID",
    "2026-01-03,NETFLIX.COM 8844,-15.49,NF-1",
    "2026-02-03,NETFLIX.COM 8844,-15.49,NF-2",
    "2026-03-03,NETFLIX.COM 8844,-15.49,NF-3",
    "2026-06-03,NETFLIX.COM 8844,-15.49,NF-4",
    "2026-07-03,NETFLIX.COM 8844,-15.49,NF-5",
    "2026-08-03,NETFLIX.COM 8844,-15.49,NF-6",
  ].join("\n");

  await uploadCsvText(page, "netflix-gapped.csv", gappedCsv);
  await expect(page.getByText("2 recurring candidates detected")).toBeVisible();

  await selectLineCheckboxes(page, [2, 3, 4, 5, 6, 7]);
  await page.getByRole("button", { name: "Merge selected" }).click();

  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(
    page.getByText("Grouped by you: 6 charges in 2 parts"),
  ).toBeVisible();
  await expect(page.getByText(/Gap of 92 days between parts/)).toBeVisible();

  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("$185.88", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("article").getByText("Medium confidence"),
  ).toBeVisible();

  // Multi-name NFLX + NETFLIX.COM where NFLX alone is ignored by auto-detection
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  const multiNameCsv = [
    "Date,Description,Amount,Transaction ID",
    "2026-01-15,NFLX,-15.49,X0",
    "2026-05-03,NETFLIX.COM,-15.49,N1",
    "2026-06-03,NETFLIX.COM,-15.49,N2",
    "2026-07-03,NETFLIX.COM,-15.49,N3",
  ].join("\n");

  await uploadCsvText(page, "nflx-multi.csv", multiNameCsv);
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();
  await expect(page.getByText("3 charges of $15.49")).toBeVisible();
  await selectLineCheckboxes(page, [2, 3, 4, 5]);
  await page.getByLabel("Optional service name").fill("Netflix Bundle");
  await page.getByRole("button", { name: "Merge selected" }).click();

  await expect(
    page.getByText("Netflix Bundle", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Applied", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Grouped by you: 4 charges in 2 parts"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await page
    .getByRole("dialog", { name: "Replace your current saved audit?" })
    .getByRole("button", { name: "Replace audit" })
    .click();
  await expect(page).toHaveURL(/\/results/);
  await expect(
    page.getByRole("heading", { name: "Netflix Bundle" }),
  ).toBeVisible();
  await expect(page.getByText("$185.88", { exact: true })).toBeVisible();
});

test("3. Rejected overlapping_services & mixed_periods block Analyze, while no_expense and inactive explain status clearly", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  const parallelAdobeCsv = [
    "Date,Description,Amount,Transaction ID",
    "2026-08-03,ADOBE PHOTOSHOP,-9.99,P0",
    "2026-08-03,ADOBE ACROBAT,-19.99,A0",
    "2026-09-03,ADOBE PHOTOSHOP,-9.99,P1",
    "2026-09-03,ADOBE ACROBAT,-19.99,A1",
    "2026-10-03,ADOBE PHOTOSHOP,-9.99,P2",
    "2026-10-03,ADOBE ACROBAT,-19.99,A2",
  ].join("\n");

  await uploadCsvText(page, "adobe-parallel.csv", parallelAdobeCsv);
  await expect(page.getByText("2 recurring candidates detected")).toBeVisible();
  await expect(page.getByText("$119.88/yr")).toBeVisible();
  await expect(page.getByText("$239.88/yr")).toBeVisible();

  await selectLineCheckboxes(page, [2, 3, 4, 5, 6, 7]);
  await page.getByRole("button", { name: "Merge selected" }).click();

  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Overlapping services cannot be merged into one price."),
  ).toBeVisible();
  await expect(page.getByText("2 recurring candidates detected")).toBeVisible();
  await expect(page.getByText("$119.88/yr")).toBeVisible();
  await expect(page.getByText("$239.88/yr")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /Undo grouping/ }).click();
  await expect(
    page.getByRole("button", { name: "Analyze expenses (2)" }),
  ).toBeEnabled();

  // mixed_periods rejection -> Undo restores $219.87/yr
  const mixedPeriodsCsv = [
    "Date,Description,Amount,Transaction ID",
    "2024-01-03,ADOBE,-99.99,Y0",
    "2025-01-03,ADOBE,-99.99,Y1",
    "2026-01-03,ADOBE,-9.99,M0",
    "2026-02-03,ADOBE,-9.99,M1",
    "2026-03-03,ADOBE,-9.99,M2",
  ].join("\n");

  await uploadCsvText(page, "adobe-mixed.csv", mixedPeriodsCsv);
  await selectLineCheckboxes(page, [2, 3, 4, 5, 6]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Parts with different billing frequencies cannot be merged."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  await page.getByRole("button", { name: /Undo grouping/ }).click();
  await page.getByRole("button", { name: "Analyze expenses (2)" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("$219.87", { exact: true })).toBeVisible();

  // applied / no_expense and inactive (not applied) do not block valid candidates
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  const noExpensePlusNetflix = [
    "Date,Description,Amount",
    "2026-01-02,WHOLE FOODS MARKET,-42.00",
    "2026-03-15,TRADER JOES,-38.00",
    "2026-08-03,NETFLIX.COM 8844,-15.49",
    "2026-09-03,NETFLIX.COM 8844,-15.49",
    "2026-10-03,NETFLIX.COM 8844,-15.49",
  ].join("\n");

  await uploadCsvText(page, "no-expense.csv", noExpensePlusNetflix);
  await selectLineCheckboxes(page, [2, 3]);
  await page.getByRole("button", { name: "Merge selected" }).click();

  await expect(
    page.getByText("Applied — no recurring expense", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Selected rows did not form a recurring expense/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze expenses (1)" }),
  ).toBeEnabled();

  // Excluding one row from the 2-row merge transitions it to inactive (not applied)
  await page.getByRole("button", { name: "Exclude line 2" }).click();
  await expect(
    page.getByText("Inactive (not applied)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze expenses (1)" }),
  ).toBeEnabled();
});

test("4. large_price_change needs confirmation, Cancel keeps blocked, Confirm applies ($239.88), and Edit/Exclude->Confirm->Restore clears stale approval", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  const jumpCsv = [
    "Date,Description,Amount,Transaction ID",
    "2026-01-03,ADOBE,-9.99,J0",
    "2026-02-03,ADOBE,-9.99,J1",
    "2026-03-03,ADOBE,-9.99,J2",
    "2026-06-03,ADOBE,-19.99,J3",
    "2026-07-03,ADOBE,-19.99,J4",
    "2026-08-03,ADOBE,-19.99,J5",
  ].join("\n");

  await uploadCsvText(page, "adobe-jump.csv", jumpCsv);
  await selectLineCheckboxes(page, [2, 3, 4, 5, 6, 7]);
  await page.getByRole("button", { name: "Merge selected" }).click();

  await expect(
    page.getByText("Needs confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  // Dialog Cancel & Escape both preserve blocked state
  await page.getByRole("button", { name: "Review & confirm" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("different plan or separate service");
  await expect(dialog.getByText("$19.99/mo")).toBeVisible();
  await expect(dialog.getByText("Monthly · $239.88/yr")).toBeVisible();
  await expect(dialog.getByText("6 charges across 2 parts")).toBeVisible();
  await expect(dialog.getByText("92 days")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Review & confirm" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  // Confirm applies merge
  await page.getByRole("button", { name: "Review & confirm" }).click();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Analyze expenses (1)" }),
  ).toBeEnabled();

  // Stale confirmation after editing amount on Line 7
  await page.getByRole("button", { name: "Edit line 7" }).click();
  await page.getByRole("textbox", { name: "Amount (Amount)" }).fill("-24.99");
  await page.getByRole("button", { name: "Save row" }).click();

  await expect(
    page.getByText("Needs confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  // Restore original -19.99 amount via edit, re-confirm, then test Edit date staleness
  await page.getByRole("button", { name: "Edit line 7" }).click();
  await page.getByRole("textbox", { name: "Amount (Amount)" }).fill("-19.99");
  await page.getByRole("button", { name: "Save row" }).click();
  await page.getByRole("button", { name: "Review & confirm" }).click();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Edit line 5" }).click();
  await page.getByRole("textbox", { name: "Date (YYYY-MM-DD)" }).fill("2026-06-10");
  await page.getByRole("button", { name: "Save row" }).click();
  await expect(
    page.getByText("Needs confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  // Exclude -> Confirm -> Restore -> Re-exclude never resurrects prior consent
  await page.getByRole("button", { name: "Edit line 5" }).click();
  await page.getByRole("textbox", { name: "Date (YYYY-MM-DD)" }).fill("2026-06-03");
  await page.getByRole("button", { name: "Save row" }).click();

  await page.getByRole("button", { name: "Exclude line 2" }).click();
  await page.getByRole("button", { name: "Review & confirm" }).click();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Restore line 2" }).click();
  await expect(
    page.getByText("Needs confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  // Excluding Line 2 again without re-confirming must stay Needs confirmation
  await page.getByRole("button", { name: "Exclude line 2" }).click();
  await expect(
    page.getByText("Needs confirmation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Analyze expenses/ }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Restore line 2" }).click();
  await page.getByRole("button", { name: "Review & confirm" }).click();
  await dialog.getByRole("button", { name: "Confirm merge" }).click();
  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();

  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("$239.88", { exact: true })).toBeVisible();

  // Ordinary Edit/Exclude/Restore on a regular group recalculates composition and annual total
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  const regularMergeCsv = [
    "Date,Description,Amount",
    "2026-01-03,NETFLIX.COM 8844,-15.49",
    "2026-02-03,NETFLIX.COM 8844,-15.49",
    "2026-03-03,NETFLIX.COM 8844,-15.49",
    "2026-06-03,NETFLIX.COM 8844,-15.49",
    "2026-07-03,NETFLIX.COM 8844,-15.49",
    "2026-08-03,NETFLIX.COM 8844,-15.49",
  ].join("\n");
  await uploadCsvText(page, "netflix-edit.csv", regularMergeCsv);
  await selectLineCheckboxes(page, [2, 3, 4, 5, 6, 7]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("Grouped by you: 6 charges in 2 parts")).toBeVisible();
  await expect(page.getByText("$185.88/yr")).toBeVisible();

  await page.getByRole("button", { name: "Exclude line 2" }).click();
  await expect(page.getByText("Grouped by you: 5 charges in 2 parts")).toBeVisible();
  await expect(page.getByText("Ignored rows (1): Line 2 (skipped)")).toBeVisible();

  await page.getByRole("button", { name: "Restore line 2" }).click();
  await expect(page.getByText("Grouped by you: 6 charges in 2 parts")).toBeVisible();

  await page.getByRole("button", { name: "Edit line 7" }).click();
  await page.getByRole("textbox", { name: "Amount (Amount)" }).fill("-17.49");
  await page.getByRole("button", { name: "Save row" }).click();
  await expect(page.getByText("$209.88/yr")).toBeVisible();
});

test("5. Mapping change clears grouping (keeping row edits/excludes) with notice; new file/paste and Delete my data reset cleanly", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  const csv = [
    "Date,Description,Amount,Transaction ID",
    "2026-01-03,NETFLIX.COM 8844,-15.49,NF-1",
    "2026-02-03,NETFLIX.COM 8844,-15.49,NF-2",
    "2026-06-03,NETFLIX.COM 8844,-15.49,NF-3",
    "2026-07-03,NETFLIX.COM 8844,-15.49,NF-4",
    "2026-08-03,NETFLIX.COM 8844,-15.49,NF-5",
  ].join("\n");

  await uploadCsvText(page, "mapping-reset.csv", csv);
  await page.getByRole("button", { name: "Exclude line 2" }).click();
  await selectLineCheckboxes(page, [3, 4, 5, 6]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(
    page.getByText("Active grouping rules (1)"),
  ).toBeVisible();

  // Change mapping column -> grouping clears with notice while skipped row stays excluded
  await page.getByLabel("Transaction ID (optional)").selectOption("");
  await expect(
    page.getByText("Grouping was cleared because the column mapping changed."),
  ).toBeVisible();
  await expect(page.getByText("Active grouping rules")).toHaveCount(0);
  await expect(
    page.getByText("4 valid rows · 0 needs attention · 1 excluded"),
  ).toBeVisible();

  // Re-group, then change sign convention -> also clears grouping with notice
  await selectLineCheckboxes(page, [3, 4, 5, 6]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(
    page.getByText("Active grouping rules (1)"),
  ).toBeVisible();
  await page.getByLabel("Positive numbers (e.g. 15.49)").check();
  await expect(
    page.getByText("Grouping was cleared because the column mapping changed."),
  ).toBeVisible();
  await expect(page.getByText("Active grouping rules")).toHaveCount(0);
  await page.getByLabel("Negative numbers (e.g. -15.49)").check();

  // Uploading a new file resets everything
  await uploadCsvText(page, "netflix-new.csv", VALID_NETFLIX_CSV);
  await expect(
    page.getByText("Grouping was cleared because the column mapping changed."),
  ).toHaveCount(0);
  await expect(
    page.getByText("3 valid rows · 0 needs attention · 0 excluded"),
  ).toBeVisible();

  // Paste tab: grouping cleared when input edited & on Delete my data
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  const pasteBox = page.getByRole("textbox", { name: "Paste transactions" });
  const pasteInput = [
    "2026-01-03 NETFLIX.COM 8844 -15.49",
    "2026-02-03 NETFLIX.COM 8844 -15.49",
    "2026-06-03 NETFLIX.COM 8844 -15.49",
    "2026-07-03 NETFLIX.COM 8844 -15.49",
  ].join("\n");
  await pasteBox.fill(pasteInput);
  await page.getByRole("button", { name: "Preview pasted rows" }).click();
  await selectLineCheckboxes(page, [1, 2, 3, 4]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("Active grouping rules (1)")).toBeVisible();

  // Editing paste clears existing grouping; re-preview restores empty grouping
  await pasteBox.fill(`${pasteInput}\n2026-08-03 NETFLIX.COM 8844 -15.49`);
  await expect(page.getByText("Active grouping rules")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview pasted rows" }).click();
  await selectLineCheckboxes(page, [1, 2, 3, 4, 5]);
  await page.getByRole("button", { name: "Merge selected" }).click();
  await expect(page.getByText("Active grouping rules (1)")).toBeVisible();

  await page.getByRole("button", { name: "Delete my data" }).click();
  const deleteDialog = page.getByRole("dialog");
  await deleteDialog.getByRole("button", { name: "Delete my data" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/audit");
  await page.reload();
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  await expect(page.getByText("Active grouping rules")).toHaveCount(0);
  const storageAfterDelete = await page.evaluate(() =>
    window.localStorage.getItem("familycut:audit:v1"),
  );
  expect(storageAfterDelete).toBeNull();
});

test("6. Persistence on /results preserves grouped service without leaking rawRows/sources/assignments/proposalKey to storage, URL, or AI POST", async ({
  page,
}) => {
  const capturedPayloads = await mockAiEndpoint(page);

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  const customPiiCsv = [
    "Date,Description,Amount,Account Number,Balance",
    "2026-05-03,ACME FIBER PLAN,-45.00,9988-7766,1200.50",
    "2026-06-03,ACME FIBER PLAN,-45.00,9988-7766,1155.50",
    "2026-09-03,ACME HOME INTERNET,-45.00,9988-7766,1110.50",
    "2026-10-03,ACME HOME INTERNET,-45.00,9988-7766,1065.50",
  ].join("\n");

  await uploadCsvText(page, "custom-pii.csv", customPiiCsv);
  await selectLineCheckboxes(page, [2, 3, 4, 5]);
  await page
    .getByLabel("Optional service name")
    .fill("John Smith Secret Fiber 7500");
  await page.getByRole("button", { name: "Merge selected" }).click();

  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(
    page.getByRole("heading", { name: "John Smith Secret Fiber 7500" }),
  ).toBeVisible();

  // Persist across reload without storing raw/group internals or extra bank columns
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "John Smith Secret Fiber 7500" }),
  ).toBeVisible();

  const persisted = await page.evaluate(() =>
    window.localStorage.getItem("familycut:audit:v1"),
  );
  expect(persisted).toBeTruthy();
  for (const forbidden of [
    "rawRows",
    "sourceIndex",
    "sourceIndices",
    "rawIndices",
    "assignments",
    "groupReports",
    "proposalKey",
    "confirmedFor",
    "ACME FIBER PLAN",
    "9988-7766",
    "1200.50",
  ]) {
    expect(persisted).not.toContain(forbidden);
  }

  // Trigger AI script for Cut and inspect URL & payload privacy
  await page.getByRole("radio", { name: "Cut" }).click();
  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action\?id=/);
  await expect(
    page
      .getByRole("region", {
        name: "Action details for John Smith Secret Fiber 7500",
      })
      .getByRole("heading", { name: "John Smith Secret Fiber 7500" }),
  ).toBeVisible();

  const actionUrl = page.url();
  expect(actionUrl.toLowerCase()).not.toContain("john");
  expect(actionUrl.toLowerCase()).not.toContain("smith");
  expect(actionUrl.toLowerCase()).not.toContain("secret");
  expect(actionUrl.toLowerCase()).not.toContain("4500");

  await expect.poll(() => capturedPayloads.length).toBeGreaterThan(0);
  const payload = capturedPayloads[0];
  expect(Object.keys(payload).sort()).toEqual([
    "action",
    "currentPriceCents",
    "frequency",
    "merchant",
    "tone",
  ]);
  expect(payload.merchant).toBe("Service provider");
  expect(JSON.stringify(payload).toLowerCase()).not.toContain("john");
});

test("7. Mobile 360px/375px zero horizontal overflow, unique DOM IDs, and keyboard modal/checkbox accessibility", async ({
  page,
}) => {
  const csv = [
    "Date,Description,Amount,Transaction ID",
    "2026-01-03,ADOBE,-9.99,J0",
    "2026-02-03,ADOBE,-9.99,J1",
    "2026-03-03,ADOBE,-9.99,J2",
    "2026-06-03,ADOBE,-19.99,J3",
    "2026-07-03,ADOBE,-19.99,J4",
    "2026-08-03,ADOBE,-19.99,J5",
  ].join("\n");

  for (const viewport of [
    { width: 360, height: 780 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/audit");
    await page.getByRole("tab", { name: "Upload CSV" }).click();
    await uploadCsvText(page, "mobile-adobe.csv", csv);

    const overflowBefore = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflowBefore).toBe(true);

    // Select via keyboard Space on first checkbox, plus check rest
    const firstCheckbox = page.getByRole("checkbox", {
      name: /^Select line 2:/,
    });
    await firstCheckbox.focus();
    await page.keyboard.press("Space");
    await expect(firstCheckbox).toBeChecked();

    await selectLineCheckboxes(page, [3, 4, 5, 6, 7]);
    await page
      .getByLabel("Optional service name")
      .fill("LongUnbrokenMobileGroupNameWithoutSpaces12345678901234567890");
    await page.getByRole("button", { name: "Merge selected" }).click();

    await expect(
      page.getByText("Needs confirmation", { exact: true }),
    ).toBeVisible();

    const overflowAfterGroup = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflowAfterGroup).toBe(true);

    // Keyboard open & Escape dismiss confirmation dialog, checking focus return, overflow & IDs
    const reviewBtn = page.getByRole("button", { name: "Review & confirm" });
    await reviewBtn.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    const overflowInDialog = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflowInDialog).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reviewBtn).toBeFocused();
    await expect(
      page.getByRole("button", { name: /^Analyze expenses/ }),
    ).toBeDisabled();

    // Open RowEditor on mobile and verify zero horizontal overflow & unique DOM IDs
    await page.getByRole("button", { name: "Edit line 2" }).click();
    await expect(page.getByRole("button", { name: "Save row" })).toBeVisible();
    const overflowInRowEditor = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(overflowInRowEditor).toBe(true);
    const duplicateIds = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("[id]")).map(
        (el) => el.id,
      );
      return all.length - new Set(all).size;
    });
    expect(duplicateIds).toBe(0);
  }
});

test("8. Replace audit protects non-empty real session (decisions, reported savings, goal, old /action URLs) while Manual, Demo, and Empty bypass prompt", async ({
  page,
}) => {
  const capturedPayloads = await mockAiEndpoint(page);

  // Create real saved audit with Cut decision, completed reported savings, and family goal
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "spotify.csv", VALID_SPOTIFY_CSV);
  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);

  await page.getByRole("radio", { name: "Cut" }).click();
  await page.getByRole("button", { name: "Set goal" }).click();
  await page.getByLabel("Goal name").fill("Emergency cushion");
  await page.getByLabel("Target amount ($)").fill("500");
  await page.getByRole("button", { name: "Save goal" }).click();

  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action\?id=/);
  const oldActionUrl = page.url();
  await page.getByRole("radio", { name: "Completed" }).click();

  await expect.poll(() => capturedPayloads.length).toBeGreaterThan(0);
  const initialAiCount = capturedPayloads.length;

  // Return to /audit, upload new real CSV -> Replace dialog appears
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "netflix.csv", VALID_NETFLIX_CSV);
  const analyzeBtn = page.getByRole("button", { name: "Analyze expenses (1)" });
  await analyzeBtn.click();

  const replaceDialog = page.getByRole("dialog");
  await expect(replaceDialog).toBeVisible();
  await expect(
    replaceDialog.getByRole("heading", {
      name: "Replace your current saved audit?",
    }),
  ).toBeVisible();
  await expect(
    replaceDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await expect(replaceDialog).toContainText("family savings goal");
  await expect(replaceDialog).toContainText("self-reported savings");

  // Escape preserves store/goal/decision, keeps current CSV preview open, and returns focus
  await page.keyboard.press("Escape");
  await expect(replaceDialog).toBeHidden();
  await expect(analyzeBtn).toBeFocused();
  await expect(page).toHaveURL(/\/audit/);
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  const storedAfterCancel = await page.evaluate(() =>
    window.localStorage.getItem("familycut:audit:v1"),
  );
  expect(storedAfterCancel).toContain("Emergency cushion");
  expect(storedAfterCancel).toContain("Spotify");

  // Confirm Replace audit -> creates new audit and clears old session & goal
  await analyzeBtn.click();
  await replaceDialog.getByRole("button", { name: "Replace audit" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("heading", { name: "Netflix" })).toBeVisible();
  await expect(page.getByText("Emergency cushion")).toHaveCount(0);

  // Old /action?id=... shows Expense not found and fires zero AI requests
  await page.goto(oldActionUrl);
  await expect(
    page.getByRole("heading", { name: "Expense not found" }),
  ).toBeVisible();
  expect(capturedPayloads.length).toBe(initialAiCount);

  // Sample CSV / paste import over an existing real session also asks before replacing
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await page.getByRole("button", { name: "Load sample CSV" }).click();
  await page.getByRole("button", { name: /Analyze expenses \(\d+\)/ }).click();
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();

  // Try demo data over a real saved session also confirms before replacing
  await page.getByRole("button", { name: "Try demo data" }).click();
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Replace with demo" }).click();
  await expect(page).toHaveURL(/\/results/);

  // Empty audit ("Start empty list") + CSV import bypasses Replace dialog
  await page.goto("/audit");
  await page.getByRole("button", { name: "Start empty list" }).click();
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "netflix-over-empty.csv", VALID_NETFLIX_CSV);
  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);

  // Manual tab "Analyze expenses" on real session does not open Replace dialog
  await page.goto("/audit");
  await page.getByRole("button", { name: /Analyze expenses/ }).click();
  await expect(page).toHaveURL(/\/results/);
});
