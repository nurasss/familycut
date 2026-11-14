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
