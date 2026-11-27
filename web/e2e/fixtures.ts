import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails on console errors, uncaught exceptions and CSP violations. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const bad: string[] = [];
    page.on('console', (m) => {
      // An unknown URL is a real 404 page navigation (the app then shows "Page not found"): Chromium logs it.
      // A 404 for an asset or data file is still a failure.
      if (/status of 404/.test(m.text()) && !/\/(assets|data)\//.test(m.location().url)) return;
      if (m.type() === 'error' || /content security policy/i.test(m.text())) bad.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => bad.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
    });
    await use(page);
    expect(bad, 'console errors or CSP violations').toEqual([]);
  },
});
export { expect };

export const searchBox = (page: Page) => page.getByRole('combobox', { name: 'Search ICD-11' });

/** Open a path and wait until setup has finished and the app is interactive. */
export async function openReady(page: Page, path = '/') {
  await page.goto(path);
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
}

export async function search(page: Page, q: string) {
  await searchBox(page).fill(q);
  await searchBox(page).press('Enter');
  await expect(page.locator('.result').first()).toBeVisible();
}
