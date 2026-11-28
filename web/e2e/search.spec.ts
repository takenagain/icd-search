import { test, expect, openReady, search, searchBox } from './fixtures';

test('an exact code ranks first, in any case and with or without the dot', async ({ page }) => {
  await openReady(page);
  await search(page, '8b88.0');
  await expect(page.locator('.result').first().locator('.chip')).toHaveText('8B88.0');
  await expect(page.locator('.result').first().locator('h3')).toHaveText('Bell palsy');
  await search(page, '8B88');
  await expect(page.locator('.result').first().locator('.chip')).toHaveText('8B88');
  await expect(page.locator('.result')).toHaveCount(7); // 8B88 and its six children
});

test('text search ranks the exact title first and highlights the matched words', async ({ page }) => {
  await openReady(page);
  await search(page, 'bell palsy');
  await expect(page).toHaveURL(/\/search\?q=bell\+palsy|q=bell%20palsy/);
  const first = page.locator('.result').first();
  await expect(first.locator('h3')).toHaveText('Bell palsy');
  await expect(first.locator('.snip b').first()).toHaveText('palsy');
  await expect(first.locator('.url')).toContainText('Disorders of cranial nerves');
});

test('typing shows suggestions and typos still find the code', async ({ page }) => {
  await openReady(page);
  await searchBox(page).fill('bell pal');
  await expect(page.getByRole('option').first()).toHaveText('Bell palsy');
  await searchBox(page).fill('diabtes mellitus');
  await searchBox(page).press('Enter');
  await expect(page.locator('.fuzzy')).toContainText('similar spellings');
  await expect(page.locator('.result h3').first()).toContainText('iabetes');
});

test('the Search button can submit while suggestions are open', async ({ page }) => {
  await openReady(page);
  await searchBox(page).fill('asthma');
  await expect(page.getByRole('listbox', { name: 'Suggestions' })).toBeVisible();
  await page.getByRole('button', { name: 'Search', exact: true }).click({ timeout: 3500 });
  await expect(page.getByRole('heading', { name: 'Results for asthma' })).toBeVisible();
});

test('results are paginated 10 per page with playful pagination', async ({ page }) => {
  await openReady(page);
  await search(page, 'diabetes');
  await expect(page.locator('.result')).toHaveCount(10);
  const firstPage = await page.locator('.result h3').allTextContents();
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  await expect(pager.getByRole('link', { name: 'Page 2', exact: true })).toBeVisible();
  await expect(pager.locator('[aria-current=page]')).toContainText('1');
  await pager.getByRole('link', { name: 'Page 2', exact: true }).click();
  await expect(page).toHaveURL(/p=2/);
  await expect(page.locator('.result')).toHaveCount(10);
  await expect(page.locator('.result h3').first()).not.toHaveText(firstPage[0]);
  expect(await page.locator('.result h3').allTextContents()).not.toEqual(firstPage);
  await expect(pager.locator('[aria-current=page]')).toContainText('2');
  await pager.getByRole('link', { name: /Previous/ }).click();
  await expect(page).toHaveURL(/q=diabetes$/);
});

test('deep links work on reload: search page and code page', async ({ page }) => {
  await openReady(page, '/search?q=cholera&p=1');
  await expect(page.locator('.result h3').first()).toHaveText('Cholera');
  await page.reload();
  await expect(page.locator('.result h3').first()).toHaveText('Cholera');
  await page.getByRole('link', { name: 'Cholera', exact: true }).first().click();
  await expect(page).toHaveURL(/\/code\/1A00$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cholera');
  await page.goto('/code/8B88.0');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bell palsy');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bell palsy');
  const missing = await page.goto('/no/such/page');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
