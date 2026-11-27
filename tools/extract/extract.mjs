#!/usr/bin/env node
// ICD-11 MMS extractor: walks the whole linearization from a WHO ICD-API
// (the local container or any compatible endpoint) and writes a compact,
// versioned dataset. See tools/extract/README.md.
//
// Zero dependencies (Node >= 20: global fetch, node:fs, node:crypto).

import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const SCHEMA_VERSION = 1;

const { values: opt } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:8111' },
    release: { type: 'string', default: '2026-01' },
    lang: { type: 'string', default: 'en' },
    out: { type: 'string', default: 'data/icd11-mms-2026-01' },
    cache: { type: 'string', default: '.cache/who-api' },
    concurrency: { type: 'string', default: '8' },
    'max-rps': { type: 'string', default: '60' },
    'shard-bytes': { type: 'string', default: '2500000' },
    'offline': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help) {
  console.log(`usage: node tools/extract/extract.mjs [--api URL] [--release 2026-01] [--out DIR]
  [--cache DIR] [--concurrency 8] [--max-rps 60] [--shard-bytes 2500000] [--offline]
--offline  never touch the network; fail if a response is not in the cache.`);
  process.exit(0);
}

const API = opt.api.replace(/\/$/, '');
const RELEASE = opt.release;
const MMS = `/icd/release/11/${RELEASE}/mms`;
const CANON = `http://id.who.int${MMS}`;
const CACHE_DIR = resolve(opt.cache, `${RELEASE}_${opt.lang}`);
const OUT_DIR = resolve(opt.out);
const CONCURRENCY = Number(opt.concurrency);
const MIN_GAP_MS = 1000 / Number(opt['max-rps']);
const SHARD_BYTES = Number(opt['shard-bytes']);
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// ---------- HTTP with global rate limit, retry and an on-disk cache ----------

let nextSlot = 0;
async function throttle() {
  const now = performance.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { network: 0, cached: 0, retried: 0 };

function cachePath(id) {
  // ids look like "761947693" or "761947693/other"; '/' is not valid in a file name.
  return join(CACHE_DIR, `${id === '' ? '_root' : id.replaceAll('/', '__')}.json`);
}

async function getEntity(id) {
  const file = cachePath(id);
  if (existsSync(file)) {
    stats.cached++;
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  if (opt.offline) throw new Error(`offline: ${id || 'root'} not in cache`);
  const url = `${API}${MMS}${id === '' ? '' : '/' + id}`;
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'API-Version': 'v2', 'Accept-Language': opt.lang },
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`${url}: HTTP ${res.status}`);
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 250 * 2 ** attempt);
        stats.retried++;
        continue;
      }
      // Any other non-200 is a hard error: a failed request is never "code missing".
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const body = await res.text();
      JSON.parse(body); // validate before caching
      const tmp = `${file}.tmp${process.pid}`;
      writeFileSync(tmp, body);
      renameSync(tmp, file);
      stats.network++;
      return JSON.parse(body);
    } catch (e) {
      if (String(e.message).includes('HTTP 4')) throw e;
      lastErr = e;
      await sleep(250 * 2 ** attempt);
      stats.retried++;
    }
  }
  throw lastErr;
}

// ---------- crawl ----------

const idOf = (uri) => {
  if (typeof uri !== 'string') return null;
  const i = uri.indexOf(`${MMS}/`);
  if (i >= 0) return uri.slice(i + MMS.length + 1);
  return null;
};
const foundationIdOf = (uri) => (typeof uri === 'string' ? uri.replace(/^.*\/icd\/entity\//, '') : null);

async function crawl() {
  const entities = new Map(); // id -> raw JSON
  const queue = [];
  const seen = new Set();
  const enqueue = (id) => {
    if (id == null || id === '' || seen.has(id)) return;
    seen.add(id);
    queue.push(id);
  };

  const root = await getEntity('');
  for (const c of root.child ?? []) enqueue(idOf(c));

  let active = 0;
  let done = 0;
  let failure = null;
  const tick = setInterval(() => {
    process.stderr.write(
      `\rcrawled ${done} / seen ${seen.size}  (network ${stats.network}, cache ${stats.cached}, retries ${stats.retried}) `,
    );
  }, 1000);

  await new Promise((resolveAll, rejectAll) => {
    const pump = () => {
      if (failure) return;
      while (active < CONCURRENCY && queue.length) {
        const id = queue.shift();
        active++;
        getEntity(id)
          .then((e) => {
            entities.set(id, e);
            for (const c of e.child ?? []) enqueue(idOf(c));
            // Entities referenced from elsewhere but not reachable through `child`:
            for (const k of ['exclusion', 'foundationChildElsewhere']) {
              for (const r of e[k] ?? []) enqueue(idOf(r.linearizationReference));
            }
            for (const ps of e.postcoordinationScale ?? []) {
              for (const s of ps.scaleEntity ?? []) enqueue(idOf(s));
            }
            for (const r of e.inclusion ?? []) enqueue(idOf(r.linearizationReference));
          })
          .catch((err) => {
            failure = err;
            rejectAll(err);
          })
          .finally(() => {
            active--;
            done++;
            if (failure) return;
            if (!queue.length && active === 0) resolveAll();
            else pump();
          });
      }
      if (!queue.length && active === 0) resolveAll();
    };
    pump();
  });
  clearInterval(tick);
  process.stderr.write('\n');
  return { root, entities };
}

// ---------- compact record ----------

const text = (o) => (o && typeof o['@value'] === 'string' ? o['@value'] : undefined);
const pair = (r, lookup) => {
  const label = text(r.label);
  const target = idOf(r.linearizationReference);
  return target ? [label, target] : [label];
};

const KNOWN_KEYS = new Set([
  '@context', '@id', 'parent', 'child', 'browserUrl', 'code', 'source', 'classKind', 'blockId', 'codeRange',
  'title', 'definition', 'longDefinition', 'fullySpecifiedName', 'inclusion', 'exclusion', 'indexTerm',
  'foundationChildElsewhere', 'relatedEntitiesInMaternalChapter', 'relatedEntitiesInPerinatalChapter',
  'postcoordinationScale', 'codingNote', 'notes', 'relatedImpairment', 'availableLanguages', 'releaseId', 'releaseDate',
]);

function build(entities, root) {
  const idByFoundation = new Map();
  for (const [id, e] of entities) {
    if (e.source) idByFoundation.set(foundationIdOf(e.source), id);
  }
  const census = {};
  const unresolved = { exclusion: 0, coded_elsewhere: 0, see_also: 0, scale: 0 };
  const records = new Map();

  for (const [id, e] of entities) {
    for (const k of Object.keys(e)) census[k] = (census[k] ?? 0) + 1;
    const rec = { id, c: e.code ?? '', k: e.classKind, t: text(e.title) };
    if (!rec.t) throw new Error(`${id}: no title`);
    // The API echoes the browser link; we derive it, so insist they agree.
    const wantUrl = `https://icd.who.int/browse/${RELEASE}/mms/${opt.lang}#${id}`;
    if (e.browserUrl !== wantUrl) throw new Error(`${id}: browserUrl ${e.browserUrl} != ${wantUrl}`);
    // Same for the entity URI: the manifest's uriBase + '/' + id must be exactly WHO's @id, so the site can
    // derive it instead of storing it per record (a stored uri field adds about 5.5% to the brotli download).
    const wantUri = `http://id.who.int/icd/release/11/${RELEASE}/mms/${id}`;
    if (e['@id'] !== wantUri) throw new Error(`${id}: @id ${e['@id']} != ${wantUri}`);
    const d = text(e.definition);
    if (d) rec.d = d;
    const ld = text(e.longDefinition);
    if (ld) rec.ld = ld;
    const fn = text(e.fullySpecifiedName);
    if (fn && fn !== rec.t) rec.fn = fn;
    const cn = text(e.codingNote);
    if (cn) rec.cn = cn;
    if (e.blockId) rec.bid = e.blockId;
    if (e.codeRange) rec.cr = e.codeRange;

    const inc = (e.inclusion ?? []).map((r) => pair(r));
    if (inc.length) rec.inc = inc;
    const exc = (e.exclusion ?? []).map((r) => pair(r));
    if (exc.length) rec.exc = exc;
    const ce = (e.foundationChildElsewhere ?? []).map((r) => pair(r));
    if (ce.length) rec.ce = ce;
    for (const grp of [exc, ce]) for (const p of grp) if (p.length === 1) unresolved[grp === exc ? 'exclusion' : 'coded_elsewhere']++;

    const ri = (e.relatedImpairment ?? []).map((r) => text(r.label)).filter(Boolean);
    if (ri.length) rec.ri = ri;

    const ix = [];
    const seenIx = new Set();
    for (const r of e.indexTerm ?? []) {
      const l = text(r.label);
      if (l && !seenIx.has(l)) {
        seenIx.add(l);
        ix.push(l);
      }
    }
    if (ix.length) rec.ix = ix;

    const see = [];
    for (const k of ['relatedEntitiesInMaternalChapter', 'relatedEntitiesInPerinatalChapter']) {
      for (const f of e[k] ?? []) {
        const t = idByFoundation.get(foundationIdOf(f));
        if (t) see.push(t);
        else unresolved.see_also++;
      }
    }
    if (see.length) rec.see = [...new Set(see)];

    rec.pa = idOf(e.parent?.[0]) ?? '';
    if (e.child?.length) rec.kids = e.child.map(idOf);

    if (e.postcoordinationScale?.length) {
      rec.pc = e.postcoordinationScale.map((s) => {
        const vals = (s.scaleEntity ?? []).map(idOf).filter((v) => {
          if (v == null) unresolved.scale++;
          return v != null;
        });
        return {
          a: String(s.axisName).replace(/^.*\//, ''),
          r: s.requiredPostcoordination === 'true',
          m: s.allowMultipleValues,
          v: vals,
        };
      });
    }
    records.set(id, rec);
  }

  // chapter + nearest block per entity, from the parent chain
  for (const rec of records.values()) {
    let p = rec.pa;
    let blk = '';
    let chap = '';
    const guard = new Set();
    while (p && records.has(p) && !guard.has(p)) {
      guard.add(p);
      const pr = records.get(p);
      if (!blk && pr.k === 'block') blk = p;
      if (pr.k === 'chapter') {
        chap = p;
        break;
      }
      p = pr.pa;
    }
    if (rec.k !== 'chapter') {
      if (chap) rec.chap = chap;
      if (blk) rec.blk = blk;
    }
  }
  return { records, census, unresolved };
}

// ---------- write ----------

function writeDataset({ records }, root) {
  // Depth-first pre-order keeps chapters contiguous and related rows adjacent.
  const order = [];
  const visit = (id) => {
    if (!records.has(id)) return;
    order.push(id);
    for (const c of records.get(id).kids ?? []) visit(c);
  };
  for (const c of root.child ?? []) visit(idOf(c));
  // Anything referenced but not reachable via `child` goes last.
  const inOrder = new Set(order);
  const orphans = [...records.keys()].filter((i) => !inOrder.has(i));
  order.push(...orphans);

  // uniqueness of the routing key (code, else block id, else entity id)
  const keys = new Map();
  for (const id of order) {
    const r = records.get(id);
    const key = r.c || r.bid || r.id;
    if (keys.has(key)) throw new Error(`routing key ${key} used by ${keys.get(key)} and ${id}`);
    keys.set(key, id);
  }

  for (const f of readdirSync(OUT_DIR)) if (/^shard-\d+\.ndjson$/.test(f)) rmSync(join(OUT_DIR, f));

  const shards = [];
  let buf = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    const name = `shard-${String(shards.length).padStart(3, '0')}.ndjson`;
    const body = Buffer.from(buf.join(''), 'utf8');
    writeFileSync(join(OUT_DIR, name), body);
    shards.push({ name, lines: buf.length, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') });
    buf = [];
    size = 0;
  };
  for (const id of order) {
    const line = JSON.stringify(records.get(id)) + '\n';
    buf.push(line);
    size += Buffer.byteLength(line);
    if (size >= SHARD_BYTES) flush();
  }
  flush();
  return { shards, count: order.length, orphans: orphans.length };
}

const t0 = Date.now();
const { root, entities } = await crawl();
const built = build(entities, root);
const written = writeDataset(built, root);

const meta = {
  schema: SCHEMA_VERSION,
  linearization: 'mms',
  releaseId: root.releaseId,
  releaseDate: root.releaseDate,
  language: opt.lang,
  source: 'WHO ICD-API (ICD-11 MMS), http://id.who.int/icd/release/11/' + RELEASE + '/mms',
  entities: written.count,
  orphans: written.orphans,
  unresolvedLinks: built.unresolved,
  keyCensus: Object.fromEntries(Object.entries(built.census).sort()),
  unknownKeys: Object.keys(built.census).filter((k) => !KNOWN_KEYS.has(k)),
  shards: written.shards,
};
writeFileSync(join(OUT_DIR, 'dataset.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(
  `done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${written.count} entities, ${written.shards.length} shards, ` +
    `${written.shards.reduce((a, s) => a + s.bytes, 0)} bytes; network ${stats.network}, cache ${stats.cached}`,
);
if (meta.unknownKeys.length) console.warn('unknown keys:', meta.unknownKeys.join(', '));
