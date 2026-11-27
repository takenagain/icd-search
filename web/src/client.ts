// Promise RPC to the engine worker.
import type { Brief, Detail, Neighbors, SearchResponse, Status, StepEvent, StorageInfo, Suggestion, Manifest } from './types';

type Pending = { res: (v: any) => void; rej: (e: Error) => void };

class Client {
  private worker = new Worker(new URL('./worker/engine.worker.ts', import.meta.url), { type: 'module' });
  private pending = new Map<number, Pending>();
  private seq = 0;
  private listeners = new Set<(e: StepEvent) => void>();
  private briefs = new Map<string, Brief | null>();

  constructor() {
    this.worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.event === 'step') {
        for (const l of this.listeners) l(m.payload as StepEvent);
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.res(m.result);
      else p.rej(new Error(m.error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.rej(new Error(e.message || 'worker failed'));
      this.pending.clear();
    };
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise((res, rej) => {
      const id = ++this.seq;
      this.pending.set(id, { res, rej });
      this.worker.postMessage({ id, method, args });
    });
  }

  onStep(fn: (e: StepEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  status = () => this.call<Status>('status');
  setup = () => this.call<void>('setup');
  load = () => this.call<{ ok: boolean; reason?: string }>('load');
  checkUpdate = () => this.call<{ available: boolean; manifest?: Manifest; error?: string }>('checkUpdate');
  clear = () => this.call<void>('clear');
  storageInfo = () => this.call<StorageInfo>('storageInfo');
  search = (q: string, page: number, per = 10) => this.call<SearchResponse>('search', q, page, per);
  suggest = (q: string, limit = 8) => this.call<Suggestion[]>('suggest', q, limit);
  detail = (key: string) => this.call<Detail | null>('detail', key);
  neighbors = (key: string, max = 24) => this.call<Neighbors | null>('neighbors', key, max);
  randomKey = () => this.call<string | null>('randomKey', Math.random());
  stats = () => this.call<{ docs: number; terms: number; postings: number }>('stats');

  /** Cached one-line description of a code for hover cards. */
  async brief(key: string): Promise<Brief | null> {
    if (this.briefs.has(key)) return this.briefs.get(key)!;
    const b = await this.call<Brief | null>('brief', key);
    this.briefs.set(key, b);
    return b;
  }

  seedBriefs(items: Brief[]) {
    for (const b of items) if (b.def !== undefined || !this.briefs.has(b.key)) this.briefs.set(b.key, b);
  }
}

export const client = new Client();
