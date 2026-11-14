import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEY = "familycut:audit:v1";

const VALID_NETFLIX_CSV = [
  "Date,Description,Amount",
  "2026-08-03,NETFLIX.COM 8844,-15.49",
  "2026-09-03,NETFLIX.COM 8844,-15.49",
  "2026-10-03,NETFLIX.COM 8844,-15.49",
].join("\n");

const VALID_SPOTIFY_CSV = [
  "Date,Description,Amount",
  "2026-08-05,SPOTIFY USA 2026,-11.99",
  "2026-09-05,SPOTIFY USA 2026,-11.99",
  "2026-10-05,SPOTIFY USA 2026,-11.99",
].join("\n");

const MIXED_ERROR_CSV = [
  "Date,Description,Amount",
  "2026-08-03,NETFLIX.COM 8844,-15.49",
  "2026-09-03,NETFLIX.COM 8844,-15.49",
  "2026-10-03,NETFLIX.COM 8844,-15.49",
  "2026-10-07,BROKEN ROW MISSING AMOUNT,",
].join("\n");

async function uploadCsvText(page: Page, name: string, content: string | Buffer) {
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: typeof content === "string" ? Buffer.from(content, "utf-8") : content,
  });
}

test("F04: valid CSV -> oversized CSV blocks Analyze and clears previous preview", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  await uploadCsvText(page, "netflix.csv", VALID_NETFLIX_CSV);
  const analyzeReady = page.getByRole("button", {
    name: "Analyze expenses (1)",
  });
  await expect(analyzeReady).toBeEnabled();

  const oversized = Buffer.alloc(5 * 1024 * 1024 + 16, "a");
  await uploadCsvText(page, "too-big.csv", oversized);

  await expect(page.getByText(/File exceeds the 5 MB limit/i)).toBeVisible();
  const analyzeBtn = page.getByRole("button", { name: /Analyze expenses/ });
  await expect(analyzeBtn).toBeDisabled();
  await expect(analyzeBtn).toHaveText("Analyze expenses");
});

test("F05 & F14: invalid target clears persisted targetPriceCents, removes savings, and links aria-describedby", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  await page.getByRole("textbox").fill(
    "2026-08-03 NETFLIX.COM 8844 -15.49\n2026-09-03 NETFLIX.COM 8844 -15.49\n2026-10-03 NETFLIX.COM 8844 -15.49",
  );
  await page.getByRole("button", { name: "Preview pasted rows" }).click();
  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);

  await page.getByRole("radio", { name: "Negotiate" }).click();
  const targetInput = page.getByLabel(/Target price/i);
  await targetInput.fill("10");

  await expect(page.getByText("Saves $65.88/yr (estimate)")).toBeVisible();
  const savedBefore = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(savedBefore).toContain('"targetPriceCents":1000');

  await targetInput.fill("oops");
  const errMsg = page.getByText("Enter a valid dollar amount");
  await expect(errMsg).toBeVisible();
  await expect(targetInput).toHaveAttribute("aria-invalid", "true");

  const describedBy = await targetInput.getAttribute("aria-describedby");
  const errId = await errMsg.getAttribute("id");
  expect(describedBy).toBeTruthy();
  expect(describedBy).toBe(errId);

  const savedAfter = await page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, STORAGE_KEY);
  expect(savedAfter.state.session.expenses[0].targetPriceCents).toBeUndefined();
  await expect(page.getByText("Saves $65.88/yr (estimate)")).toHaveCount(0);
  await expect(page.getByText("$65.88")).toHaveCount(0);
});

test("F13: Load sample CSV and Paste sample rows preserve Sample data badge, regular CSV does not", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await page.getByRole("button", { name: "Load sample CSV" }).click();

  const analyzeCsv = page.getByRole("button", {
    name: /Analyze expenses \(\d+\)/,
  });
  await expect(analyzeCsv).toBeEnabled();
  await analyzeCsv.click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("Sample data").first()).toBeVisible();

  await page.getByRole("link", { name: /Open action plan/ }).click();
  await expect(page).toHaveURL(/\/action/);
  await expect(page.getByText("Sample data").first()).toBeVisible();

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  await page.getByRole("button", { name: "Paste sample rows" }).click();
  const analyzePaste = page.getByRole("button", {
    name: /Analyze expenses \(\d+\)/,
  });
  await expect(analyzePaste).toBeEnabled();
  await analyzePaste.click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("Sample data").first()).toBeVisible();

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "spotify.csv", VALID_SPOTIFY_CSV);
  const analyzeReal = page.getByRole("button", { name: "Analyze expenses (1)" });
  await expect(analyzeReal).toBeEnabled();
  await analyzeReal.click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("heading", { name: "Spotify" })).toBeVisible();
  await expect(page.getByText("Sample data")).toHaveCount(0);
});

test("F10: hanging AI request keeps Template and Copy usable immediately", async ({
  page,
}) => {
  const pendingResolvers: Array<() => void> = [];
  await page.route("**/api/ai/action", async (route) => {
    await new Promise<void>((resolve) => {
      pendingResolvers.push(resolve);
    });
    await route.abort().catch(() => {});
  });

  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Try demo" }).first().click();
    await expect(page).toHaveURL(/\/results/);
    await page.getByRole("link", { name: /Open action plan/ }).click();
    await expect(page).toHaveURL(/\/action/);

    await expect(page.getByText("Template", { exact: true })).toBeVisible();
    const copyBtn = page.getByRole("button", { name: "Copy", exact: true });
    await expect(copyBtn).toBeEnabled();
    await copyBtn.click();
    await expect(page.getByText("Copied ✓")).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.trim().length).toBeGreaterThan(20);
  } finally {
    for (const resolve of pendingResolvers) {
      resolve();
    }
  }
});

test("F10, F12, F14 & F02: status/reported edits avoid extra AI POSTs, yearly notice shows, and keyboard navigation works", async ({
  page,
}) => {
  let aiPostCount = 0;
  await page.route("**/api/ai/action", async (route) => {
    aiPostCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: null,
        body: null,
        callScript: "Hi, I would like to lower my yearly plan to $80.00.",
        steps: ["Check renewal date", "Ask for annual discount"],
        limitations: ["You must contact the provider yourself."],
        source: "ai",
      }),
    });
  });

  await page.goto("/audit");
  await page.getByLabel(/Merchant/i).fill("Cloud Backup");
  await page.getByLabel(/Price/i).fill("120");
  await page.getByLabel(/Frequency/i).selectOption("yearly");
  await page.getByRole("button", { name: "Add expense" }).click();

  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);

  await expect(
    page.getByText("Billed yearly: savings may start at your next renewal."),
  ).toBeVisible();

  await page.getByRole("radio", { name: "Negotiate" }).click();
  await page.getByLabel(/Target price/i).fill("80");
  await page.getByRole("link", { name: /Open action plan/ }).click();
  await expect(page).toHaveURL(/\/action/);

  const actionRegion = page.getByRole("region", {
    name: "Action details for Cloud Backup",
  });
  await expect(
    actionRegion.getByText("Billed yearly: savings may start at your next renewal."),
  ).toBeVisible();
  await expect(
    actionRegion.getByText("Written by AI · review before sending"),
  ).toBeVisible();
  expect(aiPostCount).toBe(1);

  const attemptedRadio = page.getByRole("radio", { name: "Attempted" });
  await attemptedRadio.click();
  const completedRadio = page.getByRole("radio", { name: "Completed" });
  await completedRadio.click();

  const reportedInput = page.getByLabel(/New price you got/i);
  await reportedInput.fill("80");
  await expect(actionRegion.getByText(/Reported \$40\.00\/yr/)).toBeVisible();
  expect(aiPostCount).toBe(1);

  // Keyboard navigation: Action completion status radiogroup
  await completedRadio.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(attemptedRadio).toBeFocused();
  await expect(attemptedRadio).toHaveAttribute("aria-checked", "true");
  expect(aiPostCount).toBe(1);

  // Keyboard navigation: Message format tabs
  const scriptTab = page.getByRole("tab", { name: "Phone / chat script" });
  const emailTab = page.getByRole("tab", { name: "Email" });
  await scriptTab.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(emailTab).toBeFocused();
  await expect(emailTab).toHaveAttribute("aria-selected", "true");
  const activeTabId = await emailTab.getAttribute("id");
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    activeTabId!,
  );

  // Keyboard navigation: Message tone radiogroup
  const politeRadio = page.getByRole("radio", { name: "polite" });
  const firmRadio = page.getByRole("radio", { name: "firm" });
  await politeRadio.focus();
  await page.keyboard.press("ArrowRight");
  await expect(firmRadio).toBeFocused();
  await expect(firmRadio).toHaveAttribute("aria-checked", "true");
});

test("F04: Delete my data during in-flight CSV import does not restore data", async ({
  page,
}) => {
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();

  await uploadCsvText(page, "netflix.csv", VALID_NETFLIX_CSV);
  await page.getByRole("button", { name: "Delete my data" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete my data" })
    .click();

  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(450);

  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
  await page.goto("/results");
  await expect(page.getByText("No expenses in this audit yet")).toBeVisible();
});

test("T-13 mobile 360/375px: filled preview with error row and invalid target cause no horizontal overflow", async ({
  page,
}) => {
  for (const width of [375, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/audit");
    await page.getByRole("tab", { name: "Upload CSV" }).click();
    await uploadCsvText(page, "mixed.csv", MIXED_ERROR_CSV);

    const analyzeBtn = page.getByRole("button", { name: "Analyze expenses (1)" });
    await expect(analyzeBtn).toBeEnabled();
    await expect(page.getByText(/1 needs attention/)).toBeVisible();

    const auditDims = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(auditDims.sw, `/audit @${width}px overflow`).toBeLessThanOrEqual(
      auditDims.iw,
    );

    await analyzeBtn.click();
    if (width === 360) {
      const replaceDialog = page.getByRole("dialog", {
        name: "Replace your current saved audit?",
      });
      await expect(replaceDialog).toBeVisible();
      await replaceDialog.getByRole("button", { name: "Replace audit", exact: true }).click();
    }
    await expect(page).toHaveURL(/\/results/);
    await page.getByRole("radio", { name: "Negotiate" }).click();
    await page.getByLabel(/Target price/i).fill("oops");
    await expect(page.getByText("Enter a valid dollar amount")).toBeVisible();

    const resultsDims = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(resultsDims.sw, `/results @${width}px overflow`).toBeLessThanOrEqual(
      resultsDims.iw,
    );
  }
});

test("F03 frontend: buildSafeActionRequest sends Service provider/Netflix, omits target on Cut, preserves local Template & status stability", async ({
  page,
}) => {
  const aiPosts: Record<string, unknown>[] = [];
  await page.route("**/api/ai/action", async (route) => {
    const raw = route.request().postData() ?? "{}";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    aiPosts.push(parsed);

    const serverMerchant = String(parsed.merchant ?? "Service provider");
    const isCut = parsed.action === "cut";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: isCut ? `Cancellation request: ${serverMerchant}` : null,
        body: isCut
          ? `Hello, please cancel my ${serverMerchant} plan.`
          : null,
        callScript: isCut
          ? null
          : `Hi, please lower my monthly bill for ${serverMerchant}.`,
        steps: ["Check your bill"],
        limitations: ["You must contact the provider yourself."],
        source: "fallback",
      }),
    });
  });

  // 1. Manual entry with synthetic PII -> Negotiate -> server returns source=fallback with generic "Service provider"
  const rawPiiMerchant = "Dr Jane Doe Clinic jane.doe@example.com Acct 98765432";
  await page.goto("/audit");
  await page.getByLabel(/Merchant/i).fill(rawPiiMerchant);
  await page.getByLabel(/Price/i).fill("75");
  await page.getByLabel(/Frequency/i).selectOption("monthly");
  await page.getByRole("button", { name: "Add expense" }).click();

  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);

  await page.getByRole("radio", { name: "Negotiate" }).click();
  await page.getByLabel(/Target price/i).fill("55");
  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action/);

  const actionRegion = page.getByRole("region", {
    name: `Action details for ${rawPiiMerchant}`,
  });
  await expect(actionRegion.getByRole("heading", { name: rawPiiMerchant })).toBeVisible();
  await expect(actionRegion.getByText("Template", { exact: true })).toBeVisible();

  // Wait for first POST /api/ai/action to settle and verify exact safe payload
  await expect.poll(() => aiPosts.length).toBe(1);
  expect(aiPosts[0]).toEqual({
    merchant: "Service provider",
    action: "negotiate",
    frequency: "monthly",
    currentPriceCents: 7500,
    targetPriceCents: 5500,
    tone: "polite",
  });

  // Personalized local Template must NOT be replaced by generic "Service provider" from source="fallback"
  await expect(actionRegion.getByText("Refining draft…")).toBeHidden();
  await expect(actionRegion.getByText("Template", { exact: true })).toBeVisible();
  const panel = actionRegion.getByRole("tabpanel");
  await expect(panel).toContainText(rawPiiMerchant);
  await expect(panel).not.toContainText("Service provider");

  // Copy works immediately with personalized text
  const copyBtn = actionRegion.getByRole("button", { name: "Copy", exact: true });
  await expect(copyBtn).toBeEnabled();
  await copyBtn.click();
  await expect(actionRegion.getByText("Copied ✓")).toBeVisible();
  const copiedText = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiedText).toContain(rawPiiMerchant);

  // Changing action status and reported price must NOT trigger extra AI POSTs
  await actionRegion.getByRole("radio", { name: "Attempted" }).click();
  await actionRegion.getByRole("radio", { name: "Completed" }).click();
  await actionRegion.getByLabel(/New price you got/i).fill("50");
  await expect(actionRegion.getByText(/Reported \$300\.00\/yr/)).toBeVisible();
  expect(aiPosts.length).toBe(1);

  // Reloading keeps personalized heading & Template and sends safe payload
  await page.reload();
  await expect.poll(() => aiPosts.length).toBe(2);
  expect(aiPosts[1]).toEqual({
    merchant: "Service provider",
    action: "negotiate",
    frequency: "monthly",
    currentPriceCents: 7500,
    targetPriceCents: 5500,
    tone: "polite",
  });
  await expect(actionRegion.getByText("Refining draft…")).toBeHidden();
  await expect(actionRegion.getByRole("heading", { name: rawPiiMerchant })).toBeVisible();
  await expect(actionRegion.getByText("Template", { exact: true })).toBeVisible();
  await expect(panel).toContainText(rawPiiMerchant);
  await expect(panel).not.toContainText("Service provider");

  // 2. Switching to Cut (with target previously set) omits targetPriceCents in POST
  await page.goto("/results");
  await page.getByRole("radio", { name: "Cut" }).click();
  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action/);
  await expect.poll(() => aiPosts.length).toBe(3);
  expect(aiPosts[2]).toEqual({
    merchant: "Service provider",
    action: "cut",
    frequency: "monthly",
    currentPriceCents: 7500,
    tone: "polite",
  });
  expect(Object.hasOwn(aiPosts[2], "targetPriceCents")).toBe(false);

  // 3. Pasted bank lines for known service containing extra PII canonicalize to "Netflix" in POST
  await page.goto("/audit");
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  await page.getByRole("textbox", { name: "Paste transactions" }).fill(
    [
      "2026-08-03 NETFLIX.COM JOHN DOE john@example.com 445566 -15.99",
      "2026-09-03 NETFLIX.COM JOHN DOE john@example.com 445566 -15.99",
      "2026-10-03 NETFLIX.COM JOHN DOE john@example.com 445566 -15.99",
    ].join("\n"),
  );
  await page.getByRole("button", { name: "Preview pasted rows" }).click();
  const analyzeBtn = page.getByRole("button", { name: "Analyze expenses (1)" });
  await expect(analyzeBtn).toBeEnabled();
  await analyzeBtn.click();
  const replaceDialog = page.getByRole("dialog", {
    name: "Replace your current saved audit?",
  });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Replace audit", exact: true }).click();
  await expect(page).toHaveURL(/\/results/);
  await page.getByRole("radio", { name: "Cut" }).click();
  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action/);

  await expect.poll(() => aiPosts.length).toBe(4);
  expect(aiPosts[3]).toEqual({
    merchant: "Netflix",
    action: "cut",
    frequency: "monthly",
    currentPriceCents: 1599,
    tone: "polite",
  });
});

test("W1B3/F03 network audit: imported PII CSV /action URL and reload GET must not leak merchant slug", async ({
  page,
}) => {
  const networkLog: Array<{ method: string; url: string; body: string | null }> =
    [];
  page.on("request", (req) => {
    networkLog.push({
      method: req.method(),
      url: req.url(),
      body: req.postData(),
    });
  });

  await page.route("**/api/ai/action", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: "Cancellation request: Service provider",
        body: "Hello, please cancel my Service provider subscription.",
        callScript: null,
        steps: ["Send message"],
        limitations: ["You must contact the provider yourself."],
        source: "fallback",
      }),
    });
  });

  const piiCsv = [
    "Date,Description,Amount",
    "2026-08-03,CUSTOM INTERNET JOHN SMITH john.smith@example.com account 12345678,-75.00",
    "2026-09-03,CUSTOM INTERNET JOHN SMITH john.smith@example.com account 12345678,-75.00",
    "2026-10-03,CUSTOM INTERNET JOHN SMITH john.smith@example.com account 12345678,-75.00",
  ].join("\n");

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "custom-pii.csv", piiCsv);

  const analyzeBtn = page.getByRole("button", { name: "Analyze expenses (1)" });
  await expect(analyzeBtn).toBeEnabled();
  await analyzeBtn.click();
  await expect(page).toHaveURL(/\/results/);

  await page.getByRole("radio", { name: "Cut" }).click();
  await page.getByRole("link", { name: /Get script/i }).click();
  await expect(page).toHaveURL(/\/action\?id=/);

  const aiPostLogs = () =>
    networkLog.filter((r) => new URL(r.url).pathname === "/api/ai/action");
  await expect.poll(() => aiPostLogs().length).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(aiPostLogs()[0].body ?? "{}")).toEqual({
    merchant: "Service provider",
    action: "cut",
    frequency: "monthly",
    currentPriceCents: 7500,
    tone: "polite",
  });

  await page.reload();
  await expect(page).toHaveURL(/\/action\?id=/);
  await expect.poll(() => aiPostLogs().length).toBeGreaterThanOrEqual(2);
  expect(JSON.parse(aiPostLogs()[1].body ?? "{}")).toEqual({
    merchant: "Service provider",
    action: "cut",
    frequency: "monthly",
    currentPriceCents: 7500,
    tone: "polite",
  });

  const actionGetUrls = networkLog
    .filter(
      (r) =>
        r.method === "GET" && new URL(r.url).pathname.startsWith("/action"),
    )
    .map((r) => r.url);

  expect(actionGetUrls.length).toBeGreaterThanOrEqual(1);
  const piiPattern = /john|smith|example|12345678|custom-internet/i;
  expect([page.url(), ...actionGetUrls].join("\n")).not.toMatch(piiPattern);
});

test("W2F1: invalid, migrated slug, Keep, and deleted /action links show Expense not found with zero AI POSTs, while URL changes update selection", async ({
  page,
}) => {
  const aiPosts: Record<string, unknown>[] = [];
  await page.route("**/api/ai/action", async (route) => {
    aiPosts.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: "Request",
        body: "Hello provider.",
        callScript: "Hi there.",
        steps: ["Send"],
        limitations: ["Review manually."],
        source: "fallback",
      }),
    });
  });

  // Start demo session and read action expenses from store
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo" }).first().click();
  await expect(page).toHaveURL(/\/results/);

  const actionItems = await page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    const parsed = raw ? JSON.parse(raw) : null;
    const expenses = parsed?.state?.session?.expenses ?? [];
    return expenses
      .filter((e: { decision: string }) => e.decision === "cut" || e.decision === "negotiate")
      .map((e: { id: string; merchant: string }) => ({ id: e.id, merchant: e.merchant }));
  }, STORAGE_KEY);
  expect(actionItems.length).toBeGreaterThanOrEqual(2);
  const [firstAction, secondAction] = actionItems;

  // 1. Unknown opaque ID on /action?id=... and /action/[id]
  for (const badPath of [
    "/action?id=exp-00000000000000000000000000000000",
    "/action/exp-00000000000000000000000000000000",
  ]) {
    await page.goto(badPath);
    await expect(page.getByRole("heading", { name: "Expense not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Review" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  }
  await page.waitForTimeout(250);
  expect(aiPosts).toHaveLength(0);

  // 2. /action without ID picks the first action expense
  await page.goto("/action");
  await expect(
    page.getByRole("region", { name: `Action details for ${firstAction.merchant}` }),
  ).toBeVisible();
  await expect.poll(() => aiPosts.length).toBe(1);

  // 3. Clicking second expense in sidebar updates URL/selection, then URL navigation back switches selection
  const sidebar = page.getByRole("complementary", { name: "Selected actions list" });
  await sidebar.getByRole("button", { name: new RegExp(secondAction.merchant) }).click();
  await expect(page).toHaveURL(new RegExp(`/action\\?id=${secondAction.id}`));
  await expect(
    page.getByRole("region", { name: `Action details for ${secondAction.merchant}` }),
  ).toBeVisible();
  await expect.poll(() => aiPosts.length).toBe(2);

  await page.goto(`/action?id=${firstAction.id}`);
  await expect(
    page.getByRole("region", { name: `Action details for ${firstAction.merchant}` }),
  ).toBeVisible();
  await expect.poll(() => aiPosts.length).toBe(3);

  await page.goto(`/action/${secondAction.id}`);
  await expect(
    page.getByRole("region", { name: `Action details for ${secondAction.merchant}` }),
  ).toBeVisible();
  await expect.poll(() => aiPosts.length).toBe(4);

  // 4. Switch firstAction to Keep -> stale link shows Expense not found without AI POST
  await page.goto("/results");
  const firstCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: firstAction.merchant, exact: true }) })
    .first();
  await firstCard.getByRole("radio", { name: "Keep" }).click();

  await page.goto(`/action?id=${firstAction.id}`);
  await expect(page.getByRole("heading", { name: "Expense not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(aiPosts).toHaveLength(4);

  // 5. Delete my data -> old valid ID shows Expense not found without AI POST
  await page.getByRole("button", { name: "Delete my data" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete my data" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/action?id=${secondAction.id}`);
  await expect(page.getByRole("heading", { name: "Expense not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(aiPosts).toHaveLength(4);

  // 6. Legacy v1 slug ID migrated on reload -> old slug ID shows Expense not found without AI POST
  await page.goto("/");
  await page.evaluate((k) => {
    localStorage.setItem(
      k,
      JSON.stringify({
        state: {
          session: {
            version: 1,
            id: "legacy-session",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z",
            expenses: [
              {
                id: "exp-1-netflix",
                merchant: "Netflix",
                category: "Streaming",
                priceCents: 1549,
                frequency: "monthly",
                confidence: "high",
                decision: "cut",
                actionStatus: "not_started",
                reasons: ["3 monthly charges"],
                flags: [],
              },
            ],
          },
          isDemo: false,
        },
        version: 1,
      }),
    );
  }, STORAGE_KEY);
  await page.goto("/results");
  await expect(page.getByRole("heading", { name: "Netflix" })).toBeVisible();

  await page.goto("/action?id=exp-1-netflix");
  await expect(page.getByRole("heading", { name: "Expense not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to Review" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(aiPosts).toHaveLength(4);
});

test("F09 partial: Edit, Exclude, and Restore on valid CSV preview rows recompute candidates and Analyze readiness", async ({
  page,
}) => {
  const csv = [
    "Date,Description,Amount",
    "2026-08-10,Oak Lawn Care,-12.00",
    "2026-09-10,Oak Lawn Care,-12.00",
    "2026-10-10,Oak Lawn Care,-12.00",
  ].join("\n");

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "oaklawn.csv", csv);

  await expect(page.getByRole("button", { name: "Analyze expenses (1)" })).toBeEnabled();
  await expect(page.getByText("3 valid rows · 0 needs attention · 0 excluded")).toBeVisible();

  // Edit valid line 4 (3rd data row) amount from -12.00 to -14.00
  await page.getByRole("button", { name: "Edit line 4" }).click();
  await page.getByRole("textbox", { name: "Amount (Amount)" }).fill("-14.00");
  await page.getByRole("button", { name: "Save row" }).click();

  await expect(page.locator("tbody")).toContainText("-14.00");
  await expect(page.getByText("3 valid rows · 0 needs attention · 0 excluded")).toBeVisible();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  // Exclude lines 3 and 4 -> drops candidates to 0 and disables Analyze
  await page.getByRole("button", { name: "Exclude line 3" }).click();
  await page.getByRole("button", { name: "Exclude line 4" }).click();
  await expect(page.getByText("1 valid rows · 0 needs attention · 2 excluded")).toBeVisible();
  await expect(page.getByText("0 recurring candidates detected")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Analyze expenses/ })).toBeDisabled();

  // Restore lines 3 and 4 -> recomputes candidate and enables Analyze
  await page.getByRole("button", { name: "Restore line 3" }).click();
  await page.getByRole("button", { name: "Restore line 4" }).click();
  await expect(page.getByText("3 valid rows · 0 needs attention · 0 excluded")).toBeVisible();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  const analyzeBtn = page.getByRole("button", { name: "Analyze expenses (1)" });
  await expect(analyzeBtn).toBeEnabled();
  await analyzeBtn.click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("heading", { name: "Oak Lawn Care" })).toBeVisible();
  await expect(page.locator("body")).toContainText("$14.00");
});

test("F08 UI: manual Paid/Received Debit/Credit mapping displays non-zero Credit and edits both sides safely", async ({
  page,
}) => {
  const splitCsv = [
    "Date,Merchant,Paid,Received",
    "2026-01-05,FiberNet Utility,65.00,0.00",
    "2026-01-12,FiberNet Utility,0.00,15.00",
    "2026-02-05,FiberNet Utility,65.00,0.00",
  ].join("\n");

  await page.goto("/audit");
  await page.getByRole("tab", { name: "Upload CSV" }).click();
  await uploadCsvText(page, "split-paid-received.csv", splitCsv);

  await page.getByRole("combobox", { name: "Debit column (optional)" }).selectOption("Paid");
  await page.getByRole("combobox", { name: /^Amount/ }).selectOption("Received");

  await expect(
    page.getByText(/Using separate columns: "Paid" is treated as money spent/),
  ).toBeVisible();
  await expect(page.getByText("2 valid rows · 0 needs attention · 1 excluded")).toBeVisible();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  // Line 3 has Paid=0.00 and Received=15.00 -> preview shows Credit: 15.00, not 0.00
  const creditRow = page.locator("tbody tr").filter({ hasText: "2026-01-12" });
  await expect(creditRow).toContainText("Credit: 15.00");
  await expect(creditRow).toContainText("Refund — excluded");

  // Editing line 3 exposes separate Debit (Paid) and Credit (Received) inputs without converting credit into debit
  await page.getByRole("button", { name: "Edit line 3" }).click();
  await expect(page.getByRole("textbox", { name: "Debit (Paid)" })).toHaveValue("0.00");
  const creditInput = page.getByRole("textbox", { name: "Credit (Received)" });
  await expect(creditInput).toHaveValue("15.00");
  await creditInput.fill("20.00");
  await page.getByRole("button", { name: "Save row" }).click();

  await expect(creditRow).toContainText("Credit: 20.00");
  await expect(creditRow).toContainText("Refund — excluded");
  await expect(page.getByText("2 valid rows · 0 needs attention · 1 excluded")).toBeVisible();

  await page.getByRole("button", { name: "Analyze expenses (1)" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("heading", { name: "FiberNet Utility" })).toBeVisible();
  await expect(page.locator("body")).toContainText("$65.00");
});

test("F09 & T-13 mobile 360/375px: open row editor on mobile has zero overflow and zero duplicate DOM ids", async ({
  page,
}) => {
  for (const width of [375, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/audit");
    await page.getByRole("tab", { name: "Upload CSV" }).click();
    await page.getByRole("button", { name: "Load sample CSV" }).click();

    await expect(page.getByRole("button", { name: /Analyze expenses \(\d+\)/ })).toBeEnabled();
    await page.getByRole("button", { name: "Edit line 2" }).click();
    await expect(page.getByRole("button", { name: "Save row" })).toBeVisible();

    const auditCheck = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      return {
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        duplicates,
      };
    });

    expect(auditCheck.duplicates, `duplicate DOM ids @${width}px`).toEqual([]);
    expect(auditCheck.sw, `/audit editor @${width}px overflow`).toBeLessThanOrEqual(
      auditCheck.iw,
    );
  }
});
