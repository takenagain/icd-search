// Writes .br and .gz siblings next to every compressible file in dist/ (skips files that
// already have them, e.g. the dataset shards produced by build-data.mjs).
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');
const EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.wasm', '.ndjson', '.txt', '.webmanifest', '.xml']);
let n = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.has(extname(f)) && statSync(p).size > 256) {
      const body = readFileSync(p);
      if (!existsSync(`${p}.br`)) writeFileSync(`${p}.br`, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      if (!existsSync(`${p}.gz`)) writeFileSync(`${p}.gz`, gzipSync(body, { level: 9 }));
      n++;
    }
  }
};
walk(dist);
console.log(`precompressed ${n} files in dist/`);
