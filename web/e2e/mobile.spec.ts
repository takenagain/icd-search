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
