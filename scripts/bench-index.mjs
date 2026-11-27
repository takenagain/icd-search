// Measures the two index strategies on this machine (Node + the real wasm build):
//   A) build the index in the browser from the dataset, B) ship a prebuilt index.
// usage: node scripts/bench-index.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { initSync, IcdEngine } from '../web/src/wasm/icd_search.js';

const dir = 'data/icd11-mms-2026-01';
const shards = readdirSync(dir).filter((f) => f.endsWith('.ndjson')).sort().map((f) => readFileSync(`${dir}/${f}`));
initSync({ module: readFileSync('web/src/wasm/icd_search_bg.wasm') });

const ms = (t) => `${(performance.now() - t).toFixed(0)} ms`;
let t = performance.now();
const e = new IcdEngine();
for (const s of shards) e.add_shard(s);
console.log('add_shard x', shards.length, ms(t));
t = performance.now();
e.build_index('bench');
console.log('A) build_index (wasm)', ms(t));
t = performance.now();
const bytes = e.index_bytes();
console.log('serialise index', ms(t), `${bytes.length} bytes`);
const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
const gz = gzipSync(bytes, { level: 9 }).length;
const data = Buffer.concat(shards);
const dbr = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
console.log(`B) prebuilt index: raw ${bytes.length}  br ${br}  gz ${gz}   (dataset: raw ${data.length} br ${dbr})`);
t = performance.now();
const e2 = new IcdEngine();
for (const s of shards) e2.add_shard(s);
e2.load_index(bytes, 'bench');
console.log('B) load_index (wasm, incl. add_shard)', ms(t));
t = performance.now();
for (let i = 0; i < 50; i++) e2.search('type 2 diabetes mellitus', 1, 10);
console.log('search x50', ms(t));
console.log(e2.stats());
