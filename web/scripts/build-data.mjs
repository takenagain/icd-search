// Turns the committed extractor output (data/icd11-mms-*/) into the static files the
// site serves: content-hashed shards, precompressed siblings and manifest.json.
// FAST=1 uses cheaper brotli settings (development only).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = resolve(root, 'data/icd11-mms-2026-01');
const outDir = resolve(root, 'web/public/data');
const quality = process.env.FAST ? 5 : 11;

const meta = JSON.parse(readFileSync(join(srcDir, 'dataset.json'), 'utf8'));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sha = (b) => createHash('sha256').update(b).digest('hex');
const shards = [];
for (const s of meta.shards) {
  const body = readFileSync(join(srcDir, s.name));
  if (sha(body) !== s.sha256) throw new Error(`${s.name}: sha256 differs from dataset.json; re-run the extractor`);
  const file = s.name.replace(/\.ndjson$/, `.${s.sha256.slice(0, 10)}.ndjson`);
  const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: quality, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
  const gz = gzipSync(body, { level: 9 });
  writeFileSync(join(outDir, file), body);
  writeFileSync(join(outDir, `${file}.br`), br);
  writeFileSync(join(outDir, `${file}.gz`), gz);
  shards.push({ file, sha256: s.sha256, bytes: body.length, lines: s.lines, br: br.length, gz: gz.length });
}

const datasetId = sha(shards.map((s) => s.sha256).join('\n'));
const sum = (k) => shards.reduce((a, s) => a + s[k], 0);
const manifest = {
  schema: meta.schema,
  datasetId,
  release: meta.releaseId,
  releaseDate: meta.releaseDate,
  language: meta.language,
  linearization: meta.linearization,
  entities: meta.entities,
  // 1 record = 1 WHO entity; its URI is uriBase + '/' + id (WHO licence 1.2.3: code, title and URI travel together).
  uriBase: `http://id.who.int/icd/release/11/${meta.releaseId}/mms`,
  browserBase: `https://icd.who.int/browse/${meta.releaseId}/mms/${meta.language}`,
  source: meta.source,
  license: {
    name: 'CC BY-ND 3.0 IGO',
    url: 'https://creativecommons.org/licenses/by-nd/3.0/igo/',
    terms: 'https://icd.who.int/en/docs/icd11-license.pdf',
  },
  index: { strategy: 'browser', format: 1 },
  totals: { bytes: sum('bytes'), br: sum('br'), gz: sum('gz'), shards: shards.length },
  shards,
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`data: ${shards.length} shards, ${manifest.totals.bytes} bytes raw, ${manifest.totals.br} br, ${manifest.totals.gz} gz, dataset ${datasetId.slice(0, 12)}`);
