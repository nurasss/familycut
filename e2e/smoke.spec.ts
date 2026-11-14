import { expect, test, type Page, type Request } from '@playwright/test';

const STORAGE_KEY = 'familycut:audit:v1';

async function tryDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try demo' }).first().click();
  await expect(page).toHaveURL(/\/results/);
}

test('T-14: demo flow landing -> results -> action -> Copy, with correct numbers', async ({ page }) => {
  await tryDemo(page);
  const body = page.locator('body');
  await expect(body).toContainText('$1,769.52');
  await expect(body).toContainText('$725.76');
  await expect(body).toContainText('$0.00');
  await expect(body).toContainText('48%');

  await page.getByRole('link', { name: /Open action plan/ }).click();
  await expect(page).toHaveURL(/\/action/);
  await expect(page.getByText('Template', { exact: true })).toBeVisible();

  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect(page.getByText('Copied ✓')).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.trim().length).toBeGreaterThan(20);
});

test('T-10: AI endpoint returns 500 -> template text is still shown', async ({ page }) => {
  await page.route('**/api/ai/action', (route) => route.fulfill({ status: 500, body: 'boom' }));
  await tryDemo(page);
  await page.getByRole('link', { name: /Open action plan/ }).click();
  await expect(page.getByText('Template', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
});

test('T-11: Delete my data -> reload -> storage is empty and /results shows the empty state', async ({ page }) => {
  await tryDemo(page);
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).not.toBeNull();

  await page.getByRole('button', { name: 'Delete my data' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete my data' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/results');
  await page.reload();
  expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
  await expect(page.getByText('No expenses in this audit yet')).toBeVisible();
});

test('T-13: no horizontal scroll at 375 and 360 px', async ({ page }) => {
  for (const width of [375, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Try demo' }).first().click();
    await expect(page).toHaveURL(/\/results/);
    for (const path of ['/', '/audit', '/results', '/action']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const { sw, iw } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
      }));
      expect(sw, `${path} @${width}px: scrollWidth ${sw} > innerWidth ${iw}`).toBeLessThanOrEqual(iw);
    }
  }
});

test('Paste scenario (T-01): 3 Netflix lines -> Netflix $185.88/yr', async ({ page }) => {
  await page.goto('/audit');
  await page.getByRole('tab', { name: 'Paste transactions' }).click();
  // The only visible textbox on the Paste tab (robust against label wording changes).
  await page
    .getByRole('textbox')
    .fill('2026-08-03 NETFLIX.COM 8844 -15.49\n2026-09-03 NETFLIX.COM 8844 -15.49\n2026-10-03 NETFLIX.COM 8844 -15.49');
  await page.getByRole('button', { name: 'Preview pasted rows' }).click();
  // Wait until the preview has produced at least one recurring expense ("Analyze expenses (1)").
  const analyze = page.getByRole('button', { name: /Analyze expenses \(\d+\)/ });
  await expect(analyze).toBeVisible();
  await analyze.click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.locator('body')).toContainText('Netflix');
  await expect(page.locator('body')).toContainText('$185.88/yr');
});

test('NFR-04: the demo path sends only the minimal payload to the server', async ({ page, baseURL }) => {
  const posts: Request[] = [];
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    // Requests to any origin other than the app itself (third parties, CDNs, analytics).
    if (url.protocol !== 'data:' && url.origin !== new URL(baseURL!).origin) foreign.push(req.url());
    if (req.method() !== 'GET' && req.method() !== 'HEAD') posts.push(req);
  });

  await tryDemo(page);
  await page.getByRole('link', { name: /Open action plan/ }).click();
  await expect(page.getByText('Template', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();

  expect(posts.length).toBeGreaterThan(0);
  const allowed = ['merchant', 'action', 'frequency', 'currentPriceCents', 'targetPriceCents', 'tone'];
  for (const req of posts) {
    expect(new URL(req.url()).pathname).toBe('/api/ai/action');
    const data = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    const keys = Object.keys(data);
    expect(keys.every((k) => allowed.includes(k)), `unexpected keys: ${keys.join(',')}`).toBe(true);
    for (const required of ['merchant', 'action', 'frequency', 'currentPriceCents', 'tone']) {
      expect(keys).toContain(required);
    }
  }
  expect(foreign, `requests to other origins: ${foreign.join(', ')}`).toEqual([]);
});
