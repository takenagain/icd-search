import { test, expect, searchBox } from './fixtures';

// Slow every dataset file a little so the progress UI can be observed.
async function slowShards(page: import('@playwright/test').Page, ms = 250) {
  await page.context().route('**/data/shard-*.ndjson', async (route) => {
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ response: res });
  });
}

test('setup completes from empty storage, with real progress, then shows the search page', async ({ page }) => {
  await slowShards(page);
  await page.addInitScript(() => {
    const seen: number[] = [];
    (window as unknown as { __seen: number[] }).__seen = seen;
    new MutationObserver((muts) => {
      for (const m of muts) {
        const t = m.target as HTMLElement;
        if (t.getAttribute('aria-label') && t.closest('li.step[data-step="download"]')) seen.push(Number(t.getAttribute('aria-valuenow')));
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-valuenow'] });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Setting up ICD-11 search' })).toBeVisible();
  for (const step of ['manifest', 'storage', 'download', 'verify', 'store', 'index']) {
    await expect(page.locator(`li.step[data-step="${step}"]`)).toBeVisible();
  }
  // attribution and licence are on the setup page
  await expect(page.locator('.attribution')).toContainText('CC BY-ND 3.0 IGO');
  // the download bar moves through intermediate values (recorded in-page so no change is missed)
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
  const seen = await page.evaluate(() => (window as unknown as { __seen: number[] }).__seen);
  expect(seen.some((v) => v > 0 && v < 100), `download progress values: ${seen}`).toBe(true);
  await expect(page.getByRole('link', { name: 'About, data version and licence' })).toBeVisible();

  // data is really in IndexedDB
  const stored = await page.evaluate(
    () =>
      new Promise<{ shards: number; meta: boolean; index: boolean }>((resolve, reject) => {
        const r = indexedDB.open('icd-search');
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(['shards', 'meta', 'index']);
          const c = tx.objectStore('shards').count();
          const m = tx.objectStore('meta').get('meta');
          const i = tx.objectStore('index').get('index');
          tx.oncomplete = () => resolve({ shards: c.result, meta: !!m.result, index: !!i.result });
        };
      }),
  );
  expect(stored).toEqual({ shards: 8, meta: true, index: true });
});

test('a second visit opens from local storage without downloading the dataset', async ({ page }) => {
  await page.goto('/');
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  await page.reload();
  await expect(searchBox(page)).toBeVisible();
  expect(requests.filter((p) => /\/data\/shard-/.test(p))).toEqual([]);
});

test('a failed download shows a clear error and Try again resumes without refetching stored files', async ({ page }) => {
  let blocked = true;
  const fetched: string[] = [];
  await page.context().route('**/data/shard-*.ndjson', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    if (name.startsWith('shard-004') && blocked) return route.abort('failed');
    fetched.push(name);
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('div.error')).toContainText('Could not download shard-004', { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  const before = fetched.length;
  blocked = false;
  fetched.length = 0;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
  // shards that were already verified and stored are reused, not downloaded again
  expect(before).toBeGreaterThan(0);
  expect(fetched.length).toBeLessThan(8);
  expect(fetched.some((n) => n.startsWith('shard-004'))).toBe(true);
});

test('a corrupted file is rejected by checksum verification', async ({ page }) => {
  await page.context().route('**/data/shard-001.*.ndjson', async (route) => {
    const res = await route.fetch();
    const body = Buffer.from(await res.body());
    body[100] = body[100] ^ 0xff; // same size, different bytes
    await route.fulfill({ response: res, body });
  });
  await page.goto('/');
  await expect(page.locator('div.error')).toContainText('SHA-256 mismatch', { timeout: 60_000 });
  await expect(page.locator('li.step[data-step="verify"]')).toHaveClass(/step/);
});

test('a full or limited browser storage is reported as a storage problem', async ({ page }) => {
  // Chromium DevTools: this origin may only use 5 MB (writes beyond that fail with QuotaExceededError).
  await page.goto('/health');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(page.url()).origin, quotaSize: 5 * 1048576 });
  await page.goto('/');
  await expect(page.locator('div.error')).toContainText('storage', { timeout: 60_000 });
  await expect(page.locator('div.error')).toContainText('Free some space');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('a new dataset release is detected and applied from the manifest', async ({ page }) => {
  await page.goto('/');
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
  await page.context().route('**/data/manifest.json', async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    m.datasetId = 'f'.repeat(64); // pretend a new release id; the shard checksums are unchanged
    await route.fulfill({ response: res, json: m });
  });
  await page.reload();
  await expect(page.locator('.update-banner')).toContainText('newer ICD-11 dataset');
  await page.locator('.update-banner').getByRole('button', { name: 'Update' }).click();
  await expect(page.getByRole('heading', { name: 'Updating the ICD-11 data' })).toBeVisible();
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
});

test('about page shows the data version and clearing local data restarts setup', async ({ page }) => {
  await page.goto('/about');
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Data version' })).toBeVisible();
  await expect(page.locator('.about')).toContainText('2026-01');
  await expect(page.locator('.about')).toContainText('37,211');
  await expect(page.locator('.about')).toContainText('MIT licence');
  await expect(page.locator('.about')).toContainText('does not cover the WHO data');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear local data' }).click();
  await expect(page.getByRole('heading', { name: 'Setting up ICD-11 search' })).toBeVisible({ timeout: 30_000 });
  await expect(searchBox(page)).toBeVisible({ timeout: 60_000 });
});
