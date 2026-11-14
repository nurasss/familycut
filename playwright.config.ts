import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3210);

// Uses the system Google Chrome by default (Playwright's bundled Chromium is not available on every OS,
// e.g. macOS 13). Set PW_CHANNEL= (empty) to use the bundled Chromium after `npx playwright install chromium`.
const channel = process.env.PW_CHANNEL === undefined ? 'chrome' : process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    // Production build, no XAI_API_KEY: the app must work with the local fallback.
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { XAI_API_KEY: '', XAI_MODEL: '', NEXT_DIST_DIR: '.next-e2e' },
  },
});
