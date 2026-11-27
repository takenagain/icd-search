import { defineConfig, devices } from '@playwright/test';

// The tests run against the built site (../dist) served by scripts/serve.mjs, which sends the
// same CSP / cache / compression headers as the container image. Set E2E_BASE_URL to run the same
// tests against any running server instead, e.g. the container image in CI.
const external = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: { baseURL: external ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /(mobile|screenshots)\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    { name: 'screenshots', use: { ...devices['Desktop Chrome'], viewport: { width: 1180, height: 760 } }, testMatch: /screenshots\.spec\.ts/ },
  ],
  webServer: external ? undefined : {
    command: 'node scripts/serve.mjs --port 4173',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
