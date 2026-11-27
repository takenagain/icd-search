import { test, expect, openReady } from './fixtures';

test('a code page lists related codes with descriptions and verbatim WHO text', async ({ page }) => {
  await openReady(page, '/code/BA00');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Essential hypertension');
  await expect(page.locator('.def').first()).toContainText('Essential (primary) hypertension, accounting for 95% of all cases of hypertension');
  for (const section of ['parent', 'children', 'siblings', 'exclusions', 'coded elsewhere', 'inclusions']) {
    await expect(page.locator(`section[data-section="${section}"]`)).toBeVisible();
  }
  await expect(page.locator('section[data-section="children"] .rel')).toHaveCount(5);
  await expect(page.locator('section[data-section="exclusions"]')).toContainText('Cerebrovascular diseases');
  await expect(page.getByRole('link', { name: 'Open in the WHO ICD-11 browser' })).toHaveAttribute('href', 'https://icd.who.int/browse/2026-01/mms/en#761947693');
  await expect(page.locator('.uri')).toHaveText('http://id.who.int/icd/release/11/2026-01/mms/761947693');
  await expect(page.locator('footer')).toContainText('CC BY-ND 3.0 IGO');
});

test('hovering a related code shows a preview card with its description', async ({ page }) => {
  await openReady(page, '/code/8B88');
  const link = page.locator('section[data-section="children"]').getByRole('link', { name: /Hemifacial spasm/ });
  await link.hover();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Hemifacial spasm (HFS) is a movement disorder');
  await page.mouse.move(5, 5);
  await expect(card).toBeHidden();
});

test('preview cards open on keyboard focus and close with Escape', async ({ page }) => {
  await openReady(page, '/code/8B88');
  const link = page.locator('section[data-section="children"]').getByRole('link', { name: /Facial myokymia/ });
  await link.focus();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Facial myokymia is an involuntary twitching');
  await expect(link).toHaveAttribute('aria-describedby', 'code-preview');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('anatomy diagram highlights the region for an anatomical code and for a body-system code', async ({ page }) => {
  await openReady(page, '/code/XA6H07'); // extension code "Heart"
  const fig = page.locator('figure.anat');
  await expect(fig).toBeVisible();
  await expect(fig).toHaveAttribute('data-region', 'heart');
  await expect(fig.locator('svg .on')).not.toHaveCount(0);
  await expect(fig.locator('svg g.view.shown')).toHaveAttribute('data-view', 'organs');
  await expect(fig.locator('figcaption')).toContainText('Heart');
  await expect(fig.locator('figcaption')).toContainText('CC0');
  await page.goto('/code/BA41'); // acute myocardial infarction: matched by words in the title
  await expect(page.locator('figure.anat')).toHaveAttribute('data-region', 'heart');
  await page.goto('/code/9C61.01'); // ocular hypertension
  await expect(page.locator('figure.anat')).toHaveAttribute('data-region', 'eye');
  await page.goto('/code/1A00'); // cholera: nothing anatomical
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cholera');
});
