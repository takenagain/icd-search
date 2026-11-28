import { test, expect, openReady, search, searchBox } from './fixtures';

test('mobile: home, results and code pages fit the screen without sideways scrolling', async ({ page }) => {
  await openReady(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await search(page, 'hypertension');
  expect(await overflow()).toBeLessThanOrEqual(0);
  await page.locator('.result h3 a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await expect(searchBox(page)).toBeVisible();
});

test('mobile: the chapter browser folds away and fits the screen when opened', async ({ page }) => {
  await openReady(page);
  const toggle = page.getByRole('button', { name: 'Browse ICD-11', exact: true });
  const filter = page.getByRole('searchbox', { name: 'Filter by title or code' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 3000 });
  await expect(filter).toBeHidden();
  await toggle.click();
  await expect(filter).toBeVisible();
  await filter.fill('respiratory');
  await expect(page.getByRole('link', { name: /12 Diseases of the respiratory system/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await toggle.click();
  await expect(filter).toBeHidden();
  await expect(searchBox(page)).toBeVisible();
});
