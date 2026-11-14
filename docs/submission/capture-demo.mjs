#!/usr/bin/env node
// Capture only the fictional demo from an already-running local FamilyCut server.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const base = new URL(process.argv[2] ?? 'http://localhost:3210');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
  throw new Error('Use a local server containing only synthetic demo data.');
}
const output = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
try {
  // Avoid any live model request; the page retains its immediate local template.
  await context.route('**/api/ai/action', route => route.fulfill({ status: 503, body: '{}' }));
  const page = await context.newPage();
  await page.goto(base.href);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: path.join(output, '01-landing.png'), fullPage: true });
  await page.getByRole('button', { name: 'Try demo', exact: true }).first().click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByText('$725.76', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(output, '02-results.png'), fullPage: true });
  await page.getByRole('link', { name: /Open action plan/ }).click();
  await expect(page.getByText('Template', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, '03-action-template.png'), fullPage: true });
  await page.goto(new URL('/action?id=demo-internet', base).href);
  await expect(page.getByText('Template', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Action details for Internet Provider' })).toBeVisible();
  await page.screenshot({ path: path.join(output, '05-negotiation-template.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(new URL('/results', base).href);
  await expect(page.getByText('$725.76', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(output, '04-mobile-results.png'), fullPage: true });
  await writeFile(path.join(output, 'capture.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), source: base.origin,
    data: 'Fictional Miller family, Sample data. No user records.',
    ai: 'Intercepted locally with HTTP 503; personalized Template shown.',
    files: ['01-landing.png', '02-results.png', '03-action-template.png', '04-mobile-results.png', '05-negotiation-template.png'],
  }, null, 2) + '\n');
  console.log(`Saved demo screenshots to ${output}`);
} finally {
  await context.close();
  await browser.close();
}
