import { test, expect, openReady } from './fixtures';

test('expand a chapter and a folder and keep their context when opening a code', async ({ page }) => {
  await openReady(page);
  const browse = page.getByRole('complementary', { name: 'Browse ICD-11' });
  await expect(browse).toBeVisible({ timeout: 3000 });

  const chapter = browse.getByRole('button', { name: 'Expand Diseases of the respiratory system' });
  await chapter.click();
  await browse.getByRole('button', { name: 'Expand Certain lower respiratory tract diseases' }).click();
  const asthma = browse.getByRole('link', { name: 'CA23 Asthma', exact: true });
  await asthma.evaluate((entry) => entry.scrollIntoView({ block: 'center' }));
  await asthma.click();

  await expect(page).toHaveURL(/\/code\/CA23$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Asthma');
  await expect(asthma).toHaveAttribute('aria-current', 'page');
  await expect(asthma).toBeInViewport({ ratio: 0.9, timeout: 3000 });
  await expect(browse.getByRole('button', { name: 'Collapse Diseases of the respiratory system' })).toHaveAttribute('aria-expanded', 'true');
});

test('filter by code or title and hide leaves with the dataset offline', async ({ page }) => {
  await openReady(page);
  await page.reload();
  const browse = page.getByRole('complementary', { name: 'Browse ICD-11' });
  const filter = browse.getByRole('searchbox', { name: 'Filter by title or code' });
  await expect(filter).toBeVisible({ timeout: 3000 });
  await page.waitForLoadState('networkidle');
  await page.context().setOffline(true);

  await filter.fill('8b880');
  const leaf = browse.getByRole('link', { name: '8B88.0 Bell palsy', exact: true });
  await expect(leaf).toBeVisible();
  await expect(browse.getByText('Diseases of the nervous system', { exact: true })).toBeVisible();
  await leaf.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bell palsy');
  await expect(page.locator('figure.anat svg')).toBeVisible({ timeout: 3000 });

  const foldersOnly = browse.getByRole('checkbox', { name: 'Folders only' });
  await foldersOnly.check();
  await expect(browse.getByRole('status')).toContainText('No matching entries');
  await expect(leaf).toHaveCount(0);
  await filter.fill('disorders of facial nerve');
  await expect(browse.getByRole('link', { name: '8B88 Disorders of facial nerve', exact: true })).toBeVisible();
});
