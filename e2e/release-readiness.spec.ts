import { expect, test, type Page } from "@playwright/test";

const STORAGE_KEY = "familycut:audit:v1";

async function mockAiEndpoint(page: Page) {
  await page.route("**/api/ai/action", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        subject: "Request",
        body: "Please cancel this subscription.",
        callScript: "Hello, I would like to review my billing rate.",
        steps: ["Send the message"],
        limitations: ["Review before sending."],
        source: "fallback",
      }),
    });
  });
}

async function seedRealSessionWithGoal(
  page: Page,
  options?: {
    expenses?: Array<{
      id: string;
      merchant: string;
      priceCents: number;
      frequency: "monthly";
      decision: "keep" | "cut" | "negotiate" | "undecided";
    }>;
    goal?: { name: string; targetCents: number };
  },
) {
  const expenses = (
    options?.expenses ?? [
      {
        id: "exp-11111111111111111111111111111111",
        merchant: "Cloud Backup",
        priceCents: 1999,
        frequency: "monthly" as const,
        decision: "keep" as const,
      },
    ]
  ).map((e) => ({
    ...e,
    category: "Software",
    confidence: "manual",
    reasons: ["Added manually"],
    flags: [],
    transactionIds: [],
    actionStatus: "not_started",
  }));

  const payload = {
    state: {
      isDemo: false,
      session: {
        version: 1,
        id: "real-session-1",
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
        expenses,
        ...(options?.goal ? { goal: options.goal } : {}),
      },
    },
    version: 2,
  };

  await page.goto("/");
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [STORAGE_KEY, JSON.stringify(payload)],
  );
}

test("Empty and demo sessions bypass Try demo confirmation without extra prompts", async ({
  page,
}) => {
  // 1. Fresh empty session on /
  await page.goto("/");
  await page.getByRole("button", { name: "Try demo" }).nth(1).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Sample data").first()).toBeVisible();

  // 2. Existing demo session -> header Try demo reloads without dialog
  await page.goto("/audit");
  await page.getByRole("button", { name: "Try demo data" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 3. Explicit empty real session ("Start empty list") -> no dialog
  await page.goto("/audit");
  await page.getByRole("button", { name: "Start empty list" }).click();
  await page.getByRole("button", { name: "Try demo data" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Landing (hero & header) Try demo confirms over real session, preserves on Cancel/Escape, replaces on Confirm", async ({
  page,
}) => {
  await seedRealSessionWithGoal(page, {
    goal: { name: "Emergency cushion", targetCents: 50000 },
  });
  await page.goto("/");

  // Hero Try demo button
  const heroTryDemo = page
    .locator("main")
    .getByRole("button", { name: "Try demo" });
  await heroTryDemo.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", {
      name: "Replace your current saved audit with demo data?",
    }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Escape keeps real session & goal and returns focus to hero button
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(heroTryDemo).toBeFocused();
  await expect(page).toHaveURL(/\/$/);

  const afterEsc = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(afterEsc).toContain("Cloud Backup");
  expect(afterEsc).toContain("Emergency cushion");
  expect(afterEsc).toContain('"isDemo":false');

  // Header Try demo button -> Cancel preserves session & returns focus
  const headerTryDemo = page
    .locator("header")
    .getByRole("button", { name: "Try demo" });
  await headerTryDemo.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(headerTryDemo).toBeFocused();

  const afterCancel = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(afterCancel).toContain("Cloud Backup");
  expect(afterCancel).toContain("Emergency cushion");

  // Confirm replaces real audit with demo and navigates to /results
  await headerTryDemo.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace with demo" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("Sample data").first()).toBeVisible();
  await expect(page.getByText("Cloud Backup")).toHaveCount(0);
  await expect(page.getByText("Emergency cushion")).toHaveCount(0);
});

test("/audit Try demo data confirms over real session and Cancel/Escape preserves both session and unsaved input", async ({
  page,
}) => {
  await seedRealSessionWithGoal(page, {
    goal: { name: "Summer camp", targetCents: 120000 },
  });
  await page.goto("/audit");

  // Add unsaved paste input & preview rows
  await page.getByRole("tab", { name: "Paste transactions" }).click();
  const pasteText =
    "2026-08-05 ACME STREAMING -12.99\n2026-09-05 ACME STREAMING -12.99\n2026-10-05 ACME STREAMING -12.99";
  const textbox = page.getByRole("textbox", { name: "Paste transactions", exact: true });
  await textbox.fill(pasteText);
  await page.getByRole("button", { name: "Preview pasted rows" }).click();
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  const tryDemoDataBtn = page.getByRole("button", { name: "Try demo data" });
  await tryDemoDataBtn.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Cancel via Escape keeps real session, paste input, and preview
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(tryDemoDataBtn).toBeFocused();
  await expect(page).toHaveURL(/\/audit/);
  await expect(textbox).toHaveValue(pasteText);
  await expect(page.getByText("1 recurring candidate detected")).toBeVisible();

  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(stored).toContain("Cloud Backup");
  expect(stored).toContain("Summer camp");

  // Confirm replaces with demo and navigates to /results
  await tryDemoDataBtn.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace with demo" }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText("Sample data").first()).toBeVisible();
  await expect(page.getByText("Cloud Backup")).toHaveCount(0);
});

test("/action empty-actions Try demo confirms over real Keep-only session, Cancel keeps session, Confirm loads demo actions", async ({
  page,
}) => {
  await mockAiEndpoint(page);
  await seedRealSessionWithGoal(page, {
    goal: { name: "Car fund", targetCents: 300000 },
  });
  await page.goto("/action");

  await expect(
    page.getByRole("heading", { name: "No actions selected yet" }),
  ).toBeVisible();

  const inlineTryDemo = page
    .locator("main")
    .getByRole("button", { name: "Try demo" });
  await inlineTryDemo.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  // Cancel preserves session and stays on /action empty-actions screen
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(inlineTryDemo).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "No actions selected yet" }),
  ).toBeVisible();

  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(stored).toContain("Cloud Backup");
  expect(stored).toContain("Car fund");

  // Confirm loads demo and stays on /action with demo actions visible
  await inlineTryDemo.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Replace with demo" }).click();
  await expect(page).toHaveURL(/\/action/);
  await expect(page.getByRole("heading", { name: "Action plan" })).toBeVisible();
  await expect(page.getByText("Sample data").first()).toBeVisible();
});

test("/results goal-only real session confirms Try demo before overwriting goal", async ({
  page,
}) => {
  await seedRealSessionWithGoal(page, {
    expenses: [],
    goal: { name: "College fund", targetCents: 200000 },
  });
  await page.goto("/results");

  await expect(
    page.getByRole("heading", { name: "No expenses in this audit yet" }),
  ).toBeVisible();

  const inlineTryDemo = page
    .locator("main")
    .getByRole("button", { name: "Try demo" });
  await inlineTryDemo.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Your family savings goal (currently set)");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(inlineTryDemo).toBeFocused();
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(stored).toContain("College fund");

  await inlineTryDemo.click();
  await dialog.getByRole("button", { name: "Replace with demo" }).click();
  await expect(page.getByText("Sample data").first()).toBeVisible();
  await expect(page.getByText("Family trip · $1,500.00", { exact: true })).toBeVisible();
});

test("Mobile 360px dialog layout fits without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await seedRealSessionWithGoal(page, {
    goal: { name: "Home repair", targetCents: 150000 },
  });
  await page.goto("/audit");

  await page.getByRole("button", { name: "Try demo data" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const { sw, iw, box } = await page.evaluate(() => {
    const dlg = document.querySelector("dialog");
    return {
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      box: dlg ? dlg.getBoundingClientRect().toJSON() : null,
    };
  });
  expect(sw).toBeLessThanOrEqual(iw);
  expect(box).not.toBeNull();
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(360);

  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Replace with demo" }),
  ).toBeVisible();
});

test("Manual money input parses float-prone cents exactly and enforces $1m cap", async ({
  page,
}) => {
  await page.goto("/audit");

  await page.locator("#manual-merchant").fill("Exact Cent Club");
  await page.locator("#manual-price").fill("19.99");
  await page.getByRole("button", { name: "Add expense" }).click();

  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(stored).toContain('"priceCents":1999');

  // Exceeding $1,000,000 is rejected
  await page.locator("#manual-merchant").fill("Too Big");
  await page.locator("#manual-price").fill("1000000.01");
  await page.getByRole("button", { name: "Add expense" }).click();
  await expect(
    page.getByText("Enter a valid dollar price, e.g. 15.49"),
  ).toBeVisible();

  // Exact $1,000,000.00 is accepted
  await page.locator("#manual-price").fill("$1,000,000.00");
  await page.getByRole("button", { name: "Add expense" }).click();
  const storedMax = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(storedMax).toContain('"priceCents":100000000');
});
