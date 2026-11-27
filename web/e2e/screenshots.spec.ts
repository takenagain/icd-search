// Regenerates docs/screenshots/*.png (not a pass/fail test): npx playwright test --project=screenshots
import { test, openReady, search } from './fixtures';
import { devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const dir = '../docs/screenshots';
mkdirSync(dir, { recursive: true });

test('desktop screenshots', async ({ page }) => {
  await page.context().route('**/data/shard-*.ndjson', async (route) => {
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, 700));
    await route.fulfill({ response: res });
  });
  await page.goto('/');
  await page.locator('li.step[data-step="download"].active').waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${dir}/setup.png` });
  await page.getByRole('combobox', { name: 'Search ICD-11' }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: `${dir}/home.png` });
  await page.getByRole('combobox').fill('bell pal');
  await page.getByRole('option').first().waitFor();
  await page.screenshot({ path: `${dir}/typeahead.png` });
  await search(page, 'diabetes');
  await page.screenshot({ path: `${dir}/results.png`, fullPage: true });
  await page.goto('/code/XA6H07');
  await page.locator('figure.anat svg').waitFor();
  await page.screenshot({ path: `${dir}/code-anatomy.png`, fullPage: true });
  await page.goto('/code/8B88');
  await page.locator('section[data-section="children"]').getByRole('link', { name: /Hemifacial spasm/ }).hover();
  await page.getByRole('tooltip').waitFor();
  await page.screenshot({ path: `${dir}/code-preview.png` });
  await page.goto('/graph/BA00');
  await page.locator('g.gnode').first().waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/graph.png` });
  await page.goto('/about');
  await page.getByRole('heading', { name: 'Data version' }).waitFor();
  await page.screenshot({ path: `${dir}/about.png`, fullPage: true });
});

test('dark mode and mobile screenshots', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], colorScheme: 'dark', baseURL: 'http://127.0.0.1:4173' });
  const page = await ctx.newPage();
  await openReady(page);
  await page.screenshot({ path: `${dir}/mobile-home-dark.png` });
  await search(page, 'cholera');
  await page.screenshot({ path: `${dir}/mobile-results-dark.png` });
  await page.goto('/code/BA00');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.screenshot({ path: `${dir}/mobile-code-dark.png`, fullPage: true });
  await ctx.close();
});
