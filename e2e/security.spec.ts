import { expect, test } from '@playwright/test';

test('security headers are set and x-powered-by is gone', async ({ request }) => {
  for (const path of ['/', '/results', '/api/ai/action']) {
    const res = await request.fetch(path, {
      method: path.startsWith('/api') ? 'POST' : 'GET',
      data: path.startsWith('/api') ? { bad: 1 } : undefined,
    });
    const h = res.headers();
    expect(h['x-powered-by'], path).toBeUndefined();
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy'], path).toBe('camera=(), microphone=(), geolocation=()');
    expect(h['content-security-policy'], path).toContain("default-src 'self'");
    expect(h['content-security-policy'], path).toContain("connect-src 'self'");
  }
});

test('production build: clean console, no CSP violations, fonts load', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Try demo' }).first().click();
  await expect(page).toHaveURL(/\/results/);
  await page.getByRole('link', { name: /Open action plan/ }).click();
  await expect(page.getByText('Template', { exact: true })).toBeVisible();
  await page.goto('/audit');
  await page.waitForLoadState('networkidle');

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => `${f.family}:${f.status}`);
  });
  expect(fonts.length, 'no @font-face registered').toBeGreaterThan(0);
  expect(fonts.filter((f) => f.endsWith(':loaded')).length, fonts.join(', ')).toBeGreaterThan(0);
  expect(fonts.filter((f) => f.endsWith(':error')), 'fonts failed to load').toEqual([]);
  expect(problems).toEqual([]);
});

test('FC-SEC-02: CSV Transaction IDs never persist in localStorage or reach POST /api/ai/action', async ({
  page,
}) => {
  const storageKey = 'familycut:audit:v1';
  const csv = [
    'Date,Description,Amount,Transaction ID',
    '2026-08-03,NETFLIX.COM 8844,-15.49,TXN-SECRET-111',
    '2026-09-03,NETFLIX.COM 8844,-15.49,TXN-SECRET-222',
    '2026-10-03,NETFLIX.COM 8844,-15.49,TXN-SECRET-333',
  ].join('\n');

  await page.goto('/audit');
  await page.getByRole('tab', { name: 'Upload CSV' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'statement.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });

  const analyzeBtn = page.getByRole('button', { name: /Analyze expenses \(1\)/ });
  await expect(analyzeBtn).toBeEnabled();
  await analyzeBtn.click();

  await expect(page).toHaveURL(/\/results/);
  await expect(page.locator('body')).toContainText('Netflix');
  await expect(page.locator('body')).toContainText('$185.88/yr');

  const rawStored = await page.evaluate((k) => window.localStorage.getItem(k), storageKey);
  expect(rawStored).not.toBeNull();
  expect(rawStored).not.toContain('TXN-SECRET');
  const parsed = JSON.parse(rawStored!);
  expect(parsed.version).toBe(3);
  expect(parsed.state.session.expenses).toHaveLength(1);
  expect(parsed.state.session.expenses[0].transactionIds).toEqual([]);

  await page.reload();
  await expect(page.locator('body')).toContainText('Netflix');
  await expect(page.locator('body')).toContainText('$185.88/yr');

  // Verify POST /api/ai/action on /action for this expense contains no TXN-SECRET
  await page
    .getByRole('radiogroup', { name: 'Decision for Netflix' })
    .getByRole('radio', { name: 'Cut' })
    .click();

  const aiReqPromise = page.waitForRequest(
    (req) => new URL(req.url()).pathname === '/api/ai/action' && req.method() === 'POST',
  );
  await page.getByRole('link', { name: 'Get script' }).click();
  await expect(page).toHaveURL(/\/action/);

  const aiReq = await aiReqPromise;
  const aiBodyRaw = aiReq.postData() ?? '';
  expect(aiBodyRaw).not.toContain('TXN-SECRET');
  expect(JSON.parse(aiBodyRaw)).toEqual({
    merchant: 'Netflix',
    action: 'cut',
    frequency: 'monthly',
    currentPriceCents: 1549,
    tone: 'polite',
  });
  await expect(page.getByText('Template', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete my data' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete my data' }).click();
  await expect(page).toHaveURL(/\/$/);
  const afterDelete = await page.evaluate((k) => window.localStorage.getItem(k), storageKey);
  expect(afterDelete).toBeNull();
});
