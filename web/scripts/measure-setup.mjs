// Measures first-visit setup time (download -> verify -> store -> index -> search page) against the
// built site under an emulated network and CPU, in a real Chromium.
// usage: node scripts/measure-setup.mjs [--kbps 9000] [--latency 150] [--cpu 4] [--runs 3]
// The shared link is paced per response by serve.mjs (--kbps is per request, not shared: with 3 parallel
// shard downloads the effective link is up to 3x, so we pass kbps/3 to keep the total at the stated rate).
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: v } = parseArgs({
  options: { kbps: { type: 'string', default: '9000' }, latency: { type: 'string', default: '150' }, cpu: { type: 'string', default: '1' }, runs: { type: 'string', default: '3' }, port: { type: 'string', default: '4180' } },
});
const port = Number(v.port);
const server = spawn('node', ['scripts/serve.mjs', '--port', String(port), '--kbps', String(Math.round(Number(v.kbps) / 3)), '--latency', v.latency], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const results = [];
try {
  for (let i = 0; i < Number(v.runs); i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(v.cpu) });
    await page.addInitScript(() => {
      const t = {};
      new MutationObserver((muts) => {
        for (const m of muts) {
          const li = m.target;
          const step = li.dataset?.step;
          if (step && li.classList.contains('active') && !(step in t)) t[step] = performance.now();
          if (step && li.classList.contains('done')) t[`${step}:done`] = t[`${step}:done`] ?? performance.now();
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
      window.__steps = t;
    });
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.getByRole('searchbox').or(page.locator('input[type=search], input[role=combobox]')).first().waitFor({ timeout: 300_000 });
    const wall = (Date.now() - t0) / 1000;
    const steps = await page.evaluate(() => window.__steps);
    results.push({ wall, steps });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(JSON.stringify({ kbps: v.kbps, latencyMs: v.latency, cpuThrottle: v.cpu, runs: results.length, medianSeconds: +med(results.map((r) => r.wall)).toFixed(1), all: results.map((r) => +r.wall.toFixed(1)), steps: results[0].steps }, null, 1));
