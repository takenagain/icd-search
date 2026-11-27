// Everything heavy lives here: download, verification, IndexedDB storage, and the Rust/WASM engine.
/// <reference lib="webworker" />
import init, { IcdEngine } from '../wasm/icd_search.js';
import wasmUrl from '../wasm/icd_search_bg.wasm?url';
import type { Manifest, Status, StepEvent, StepId, StorageInfo } from '../types';
import { Db, type MetaRecord } from './db';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const DATA = '/data/';
const CONCURRENCY = 3;

let engine: IcdEngine | null = null;
let db: Db | null = null;
let wasmReady: Promise<unknown> | null = null;

const emit = (e: StepEvent) => ctx.postMessage({ event: 'step', payload: e });
const ensureWasm = () => (wasmReady ??= init({ module_or_path: wasmUrl }));
const getDb = async () => (db ??= await Db.open());

async function sha256(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Human-readable message for anything thrown (DOMExceptions often have an empty message). */
function describe(e: unknown): string {
  const name = (e as { name?: string })?.name ?? '';
  const msg = (e as { message?: string })?.message ?? String(e);
  if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
    return 'The browser refused to store the data because its storage is full or limited for this site (private browsing often does this). Free some space and try again.';
  }
  if (name === 'TypeError' && /fetch|network|load failed/i.test(msg)) return 'The network request failed. Check your connection and try again.';
  return msg || name || 'Unknown error';
}

class StageError extends Error {
  constructor(public stage: StepId, public override cause: unknown) {
    super(describe(cause));
  }
}
const stage = async <T,>(s: StepId, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    throw e instanceof StageError ? e : new StageError(s, e);
  }
};

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function fetchManifest(noCache = true): Promise<Manifest> {
  const res = await fetch(`${DATA}manifest.json`, { cache: noCache ? 'no-cache' : 'default' });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const m = (await res.json()) as Manifest;
  if (m.schema !== 1) throw new Error(`unsupported dataset schema ${m.schema}`);
  return m;
}

async function storageInfo(): Promise<StorageInfo> {
  const e = (await navigator.storage?.estimate?.()) ?? {};
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usage: e.usage, quota: e.quota, persisted };
}

async function download(file: string, expected: number, onBytes: (n: number) => void): Promise<Uint8Array> {
  const url = `${DATA}${file}`;
  let counted = 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`${file}: HTTP ${res.status}`);
      if ((res.headers.get('content-type') ?? '').includes('text/html')) {
        throw new Error(`${file}: the server answered with a web page instead of data`);
      }
      // `expected` is the decoded size: transfer compression is transparent to fetch().
      const out = new Uint8Array(expected);
      let n = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (n + value.length > expected) throw new Error(`${file}: more data than the manifest lists`);
        out.set(value, n);
        n += value.length;
        counted += value.length;
        onBytes(value.length);
      }
      if (n !== expected) throw new Error(`${file}: got ${n} bytes, expected ${expected}`);
      return out;
    } catch (e) {
      lastErr = e;
      onBytes(-counted); // restart this file from zero
      counted = 0;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw new Error(`Could not download ${file}: ${describe(lastErr)}`);
}

async function loadEngine(manifest: Manifest, mem: Map<string, Uint8Array>, store: Db): Promise<string> {
  await ensureWasm();
  engine?.free();
  const eng = new IcdEngine();
  const n = manifest.shards.length;
  emit({ step: 'index', status: 'active', done: 0, total: n + 2, note: 'Loading data into the search engine' });
  let i = 0;
  for (const s of manifest.shards) {
    const bytes = mem.get(s.file) ?? (await store.getShard(s.file));
    if (!bytes) throw new Error(`missing stored data: ${s.file}`);
    eng.add_shard(bytes);
    mem.delete(s.file);
    emit({ step: 'index', status: 'active', done: ++i, total: n + 2, note: 'Loading data into the search engine' });
  }
  let note: string;
  const saved = await store.getIndex();
  let loaded = false;
  if (saved && saved.datasetId === manifest.datasetId) {
    const t = performance.now();
    try {
      eng.load_index(saved.bytes, manifest.datasetId);
      loaded = true;
      note = `Saved search index loaded in ${Math.round(performance.now() - t)} ms`;
    } catch {
      note = '';
    }
  }
  if (!loaded) {
    emit({ step: 'index', status: 'active', done: n, total: n + 2, note: 'Building the search index (first visit only)…' });
    await new Promise((r) => setTimeout(r, 30)); // let the UI paint before the synchronous build
    const t = performance.now();
    eng.build_index(manifest.datasetId);
    const ms = Math.round(performance.now() - t);
    emit({ step: 'index', status: 'active', done: n + 1, total: n + 2, note: `Index built in ${ms} ms; saving it` });
    await store.putIndex(manifest.datasetId, eng.index_bytes());
    note = `Index built in ${ms} ms and saved for next time`;
  }
  engine = eng;
  emit({ step: 'index', status: 'done', done: n + 2, total: n + 2, note: note! });
  return note!;
}

async function setup(): Promise<void> {
  const store = await getDb();
  const step = (s: StepId, status: StepEvent['status'], extra: Partial<StepEvent> = {}) => emit({ step: s, status, ...extra });
  let current: StepId = 'manifest';
  try {
    step('manifest', 'active');
    const manifest = await fetchManifest();
    step('manifest', 'done', { note: `ICD-11 MMS ${manifest.release} · ${manifest.entities.toLocaleString('en')} entities · ${manifest.totals.shards} files` });

    current = 'storage';
    step('storage', 'active');
    const info = await storageInfo();
    const persisted = (await navigator.storage?.persist?.().catch(() => false)) ?? false;
    const need = Math.round((manifest.totals.bytes + 6 * 1048576) * 1.25);
    if (info.quota !== undefined && info.usage !== undefined && info.quota - info.usage < need) {
      throw new Error(
        `Not enough browser storage: about ${mb(need)} needed, ${mb(Math.max(0, info.quota - info.usage))} available. ` +
          'Free some space (or leave private browsing) and retry.',
      );
    }
    step('storage', 'done', {
      note: info.quota ? `${mb(info.quota - (info.usage ?? 0))} free of ${mb(info.quota)} · need about ${mb(need)} · ${persisted ? 'persistent' : 'best-effort'} storage` : `need about ${mb(need)}`,
    });

    // A new dataset replaces the old one only after everything verified; mark incomplete meanwhile.
    await store.clearMeta();
    const have = new Set(await store.shardKeys());
    const mem = new Map<string, Uint8Array>();
    const total = manifest.totals.bytes;
    const prog = { download: 0, verify: 0, store: 0 };
    let lastEmit = 0;
    const report = (force = false) => {
      const now = performance.now();
      if (!force && now - lastEmit < 80) return;
      lastEmit = now;
      const filesDone = (k: keyof typeof prog) => progFiles[k].filter(Boolean).length;
      step('download', 'active', { done: prog.download, total, note: `${filesDone('download')} of ${manifest.shards.length} files · ${mb(prog.download)} of ${mb(total)} (about ${mb(manifest.totals.br)} on the wire)` });
      step('verify', 'active', { done: prog.verify, total, note: `${filesDone('verify')} of ${manifest.shards.length} files checked against SHA-256` });
      step('store', 'active', { done: prog.store, total, note: `${filesDone('store')} of ${manifest.shards.length} files saved in IndexedDB` });
    };
    const progFiles = { download: [] as boolean[], verify: [] as boolean[], store: [] as boolean[] };
    current = 'download';
    report(true);

    let next = 0;
    const worker = async () => {
      while (next < manifest.shards.length) {
        const idx = next++;
        const s = manifest.shards[idx];
        let bytes: Uint8Array | undefined;
        let reused = false;
        if (have.has(s.file)) {
          bytes = await stage('store', () => store.getShard(s.file));
          if (bytes && bytes.length === s.bytes && (await sha256(bytes)) === s.sha256) reused = true;
          else bytes = undefined;
        }
        if (reused && bytes) {
          prog.download += s.bytes;
          progFiles.download[idx] = true;
          report();
          prog.verify += s.bytes;
          progFiles.verify[idx] = true;
          prog.store += s.bytes;
          progFiles.store[idx] = true;
          report();
        } else {
          bytes = await stage('download', () =>
            download(s.file, s.bytes, (n) => {
              prog.download += n;
              report();
            }),
          );
          progFiles.download[idx] = true;
          report();
          if ((await sha256(bytes)) !== s.sha256) throw new StageError('verify', new Error(`${s.file}: SHA-256 mismatch (the download is corrupted). Try again.`));
          prog.verify += s.bytes;
          progFiles.verify[idx] = true;
          report();
          await stage('store', () => store.putShard(s.file, bytes!));
          prog.store += s.bytes;
          progFiles.store[idx] = true;
          report();
        }
        mem.set(s.file, bytes);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    report(true);
    for (const k of ['download', 'verify', 'store'] as const) step(k, 'done', { done: total, total });
    // drop shards of older releases
    const keep = new Set(manifest.shards.map((s) => s.file));
    await store.deleteShards([...have].filter((f) => !keep.has(f)));

    current = 'index';
    await loadEngine(manifest, mem, store);
    const meta: MetaRecord = { datasetId: manifest.datasetId, completedAt: new Date().toISOString(), manifest };
    await store.putMeta(meta);
  } catch (e) {
    const failed = e instanceof StageError ? e.stage : current;
    const note = describe(e);
    step(failed, 'error', { note });
    throw new Error(note);
  }
}

/** Open the stored dataset without downloading anything. */
async function load(): Promise<{ ok: boolean; reason?: string }> {
  const store = await getDb();
  const meta = await store.getMeta();
  if (!meta) return { ok: false, reason: 'empty' };
  const manifest = meta.manifest as Manifest;
  const have = new Set(await store.shardKeys());
  if (!manifest.shards.every((s) => have.has(s.file))) return { ok: false, reason: 'evicted' };
  try {
    emit({ step: 'store', status: 'active', note: 'Reading saved data' });
    await loadEngine(manifest, new Map(), store);
    return { ok: true };
  } catch (e) {
    await store.clearMeta();
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

async function status(): Promise<Status> {
  const meta = await (await getDb()).getMeta();
  if (!meta) return { stored: false };
  const m = meta.manifest as Manifest;
  return { stored: true, datasetId: meta.datasetId, release: m.release, releaseDate: m.releaseDate, entities: m.entities, bytes: m.totals.bytes, completedAt: meta.completedAt, manifest: m };
}

async function checkUpdate(): Promise<{ available: boolean; manifest?: Manifest; error?: string }> {
  try {
    const [remote, meta] = await Promise.all([fetchManifest(), getDb().then((d) => d.getMeta())]);
    return { available: !meta || meta.datasetId !== remote.datasetId, manifest: remote };
  } catch (e) {
    return { available: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function clear(): Promise<void> {
  engine?.free();
  engine = null;
  db?.close();
  db = null;
  await Db.destroy();
}

const need = (): IcdEngine => {
  if (!engine) throw new Error('search engine is not ready');
  return engine;
};
const parse = <T>(s: string | undefined | null): T | null => (s ? (JSON.parse(s) as T) : null);

const methods: Record<string, (...a: any[]) => unknown> = {
  status,
  setup,
  load,
  checkUpdate,
  clear,
  storageInfo,
  search: (q: string, page: number, per: number) => JSON.parse(need().search(q, page, per)),
  suggest: (q: string, limit: number) => JSON.parse(need().suggest(q, limit)),
  detail: (key: string) => parse(need().detail(key)),
  brief: (key: string) => parse(need().brief(key)),
  neighbors: (key: string, max: number) => parse(need().neighbors(key, max)),
  randomKey: (r: number) => need().random_key(r) ?? null,
  stats: () => JSON.parse(need().stats()),
};

ctx.onmessage = async (ev: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
  const { id, method, args } = ev.data;
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`unknown method ${method}`);
    ctx.postMessage({ id, ok: true, result: await fn(...args) });
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
