import { test, expect, openReady } from './fixtures';

test('graph view shows hierarchy and cross-reference edges, and clicking a node navigates', async ({ page }) => {
  await openReady(page, '/graph/BA00');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Essential hypertension');
  await expect(page.locator('g.gnode.center')).toHaveAttribute('data-key', 'BA00');
  await expect(page.locator('line.edge.hier').first()).toBeVisible();
  await expect(page.locator('line.edge.exclusion').first()).toBeAttached();
  await expect(page.locator('line.edge.coded_elsewhere').first()).toBeAttached();
  const child = page.locator('g.gnode[data-key="BA00.1"]');
  await expect(child).toBeVisible();
  await child.click();
  await expect(page).toHaveURL(/\/graph\/BA00\.1$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Isolated diastolic hypertension');
  await expect(page.locator('g.gnode.center')).toHaveAttribute('data-key', 'BA00.1');
});

test('a child can be expanded in place with the keyboard', async ({ page }) => {
  await openReady(page, '/graph/01');
  await expect(page.locator('g.gnode.center')).toHaveAttribute('data-key', '01');
  const before = await page.locator('g.gnode').count();
  expect(before).toBeGreaterThan(3);
  const child = page.locator('g.gnode.k-block').first();
  await child.focus();
  await page.keyboard.press('e');
  await expect.poll(() => page.locator('g.gnode').count()).toBeGreaterThan(before);
});

test('a block with hundreds of children is paged, and "more" extends it on demand', async ({ page }) => {
  // "Other local antifungal, anti-infective and anti-inflammatory drugs": 299 children.
  await openReady(page, '/graph/2063870164');
  const nodes = page.locator('g.gnode');
  await expect(nodes.first()).toBeVisible();
  const more = page.locator('g.gnode.k-more');
  await expect(more).toHaveCount(1);
  const n = await nodes.count();
  expect(n).toBeLessThan(60);
  await more.click();
  await expect.poll(() => nodes.count()).toBeGreaterThan(n);
  await expect(page.getByRole('button', { name: 'Fit graph to view' })).toBeEnabled();
});
