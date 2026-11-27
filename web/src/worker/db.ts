// IndexedDB wrapper: dataset shards, the serialised search index and a completion marker.

const NAME = 'icd-search';
const VERSION = 1;

export interface MetaRecord {
  datasetId: string;
  completedAt: string;
  manifest: unknown;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error('transaction aborted'));
  });
}

export class Db {
  private constructor(private db: IDBDatabase) {}

  static open(): Promise<Db> {
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('shards'); // key: file name (content hashed)
        d.createObjectStore('meta'); // 'meta' -> MetaRecord (written last)
        d.createObjectStore('index'); // 'index' -> { datasetId, bytes }
      };
      r.onsuccess = () => res(new Db(r.result));
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB is blocked by another tab'));
    });
  }

  close() {
    this.db.close();
  }

  static async destroy(): Promise<void> {
    await new Promise<void>((res, rej) => {
      const r = indexedDB.deleteDatabase(NAME);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Close other ICD tabs, then try again.'));
    });
  }

  async getMeta(): Promise<MetaRecord | undefined> {
    return req(this.db.transaction('meta').objectStore('meta').get('meta'));
  }

  async putMeta(m: MetaRecord): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(m, 'meta');
    await done(tx);
  }

  async clearMeta(): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete('meta');
    await done(tx);
  }

  async shardKeys(): Promise<string[]> {
    return (await req(this.db.transaction('shards').objectStore('shards').getAllKeys())) as string[];
  }

  async getShard(file: string): Promise<Uint8Array | undefined> {
    const b = (await req(this.db.transaction('shards').objectStore('shards').get(file))) as ArrayBuffer | undefined;
    return b && new Uint8Array(b);
  }

  async putShard(file: string, bytes: Uint8Array): Promise<void> {
    const tx = this.db.transaction('shards', 'readwrite');
    // Copy the exact range: a view may sit on a larger buffer.
    tx.objectStore('shards').put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file);
    await done(tx);
  }

  async deleteShards(files: string[]): Promise<void> {
    if (!files.length) return;
    const tx = this.db.transaction('shards', 'readwrite');
    for (const f of files) tx.objectStore('shards').delete(f);
    await done(tx);
  }

  async getIndex(): Promise<{ datasetId: string; bytes: Uint8Array } | undefined> {
    const r = (await req(this.db.transaction('index').objectStore('index').get('index'))) as
      | { datasetId: string; bytes: ArrayBuffer }
      | undefined;
    return r && { datasetId: r.datasetId, bytes: new Uint8Array(r.bytes) };
  }

  async putIndex(datasetId: string, bytes: Uint8Array): Promise<void> {
    const tx = this.db.transaction('index', 'readwrite');
    tx.objectStore('index').put({ datasetId, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, 'index');
    await done(tx);
  }

  async clearIndex(): Promise<void> {
    const tx = this.db.transaction('index', 'readwrite');
    tx.objectStore('index').delete('index');
    await done(tx);
  }
}
