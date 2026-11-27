// Reports how much of the classification gets an anatomy diagram, using the app's own mapping (src/anatomy).
// usage: node scripts/anatomy-coverage.mjs        (prints Markdown; numbers quoted in docs/ANATOMY.md)
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, '../data/icd11-mms-2026-01');
const recs = readdirSync(dir).filter((f) => f.endsWith('.ndjson')).sort().flatMap((f) => readFileSync(resolve(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const byId = new Map(recs.map((r) => [r.id, r]));
const brief = (r) => (r ? { key: r.c || r.bid || r.id, code: r.c || '', title: r.t, kind: r.k } : null);

const vite = await createServer({ root, logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });
const { anatomyFor } = await vite.ssrLoadModule('/src/anatomy/anatomy.ts');

const stats = new Map(); // group -> { total, matched, byRegion }
const bump = (group, hit, region) => {
  const g = stats.get(group) ?? { total: 0, matched: 0, byRegion: new Map() };
  g.total++;
  if (hit) (g.matched++, g.byRegion.set(region, (g.byRegion.get(region) ?? 0) + 1));
  stats.set(group, g);
};
const why = new Map();
for (const r of recs) {
  const chap = byId.get(r.chap ?? '');
  const d = {
    kind: r.k, code: r.c || '', title: r.t, fullySpecifiedName: r.fn ?? null, indexTerms: r.ix ?? [],
    path: chap && chap !== r ? [brief(chap)] : [],
  };
  const m = anatomyFor(d);
  const group = r.c?.startsWith('XA') ? 'XA anatomy extension codes' : r.k === 'chapter' ? 'chapters' : `chapter ${chap?.c ?? '-'} entries`;
  bump(group, !!m, m?.region);
  bump('all entities', !!m, m?.region);
  if (m) {
    const kind = m.why.startsWith('body-system') ? 'chapter fallback' : 'words in title or index terms';
    why.set(kind, (why.get(kind) ?? 0) + 1);
  }
}
await vite.close();
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log('| Group | Entities | With a diagram | Share |\n|---|---:|---:|---:|');
for (const [g, s] of [...stats].sort((a, b) => (a[0] === 'all entities' ? -1 : b[0] === 'all entities' ? 1 : a[0].localeCompare(b[0])))) console.log(`| ${g} | ${s.total.toLocaleString('en')} | ${s.matched.toLocaleString('en')} | ${pct(s.matched, s.total)} |`);
console.log(`\nMatched by: ${[...why].map(([k, v]) => `${k} ${v.toLocaleString('en')}`).join('; ')}`);
const xa = stats.get('XA anatomy extension codes');
console.log(`\nXA regions: ${[...xa.byRegion].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
