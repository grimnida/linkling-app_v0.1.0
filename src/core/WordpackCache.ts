/**
 * WordpackCache — IndexedDB(pack JSON·메타) + Cache Storage(.riv/AAC/SVG).
 * - versioned 경로라 같은 버전은 불변으로 취급한다.
 * - 버전이 바뀌면 새 버전으로 교체하고 이전 버전을 정리한다.
 * - LRU 정책으로 오래된 팩 제거.
 * - Node/테스트 환경에서는 자동으로 in-memory 구현으로 동작한다.
 */
import type { LoadedPack } from './types';
import { CONFIG } from './config';

interface StoredPackRecord {
  key: string; // word_id
  version: string;
  manifestUrl: string;
  manifest: unknown;
  wordpack: unknown;
  entry: unknown;
  storedAt: number;
  lastUsedAt: number;
}

const DB_NAME = 'linkling-content';
const DB_VERSION = 1;
const STORE = 'packs';
const CONTENT_CACHE = 'linkling-content-v1';

export class WordpackCache {
  private mem = new Map<string, StoredPackRecord>();
  private useIdb: boolean;

  constructor(private readonly now: () => number = Date.now) {
    this.useIdb = typeof indexedDB !== 'undefined';
  }

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async idbGet(key: string): Promise<StoredPackRecord | null> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      tx.onsuccess = () => resolve((tx.result as StoredPackRecord) ?? null);
      tx.onerror = () => reject(tx.error);
    });
  }

  private async idbPut(rec: StoredPackRecord): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async idbAll(): Promise<StoredPackRecord[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      tx.onsuccess = () => resolve(tx.result as StoredPackRecord[]);
      tx.onerror = () => reject(tx.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      tx.onsuccess = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(wordId: string, version: string): Promise<StoredPackRecord | null> {
    const rec = this.useIdb ? await this.idbGet(wordId).catch(() => this.mem.get(wordId) ?? null) : this.mem.get(wordId) ?? null;
    if (!rec) return null;
    if (rec.version !== version) return null; // 버전이 다르면 캐시 미스 → 새 버전으로 교체됨
    rec.lastUsedAt = this.now();
    void this.put(rec);
    return rec;
  }

  async put(rec: StoredPackRecord): Promise<void> {
    this.mem.set(rec.key, rec);
    if (this.useIdb) await this.idbPut(rec).catch(() => void 0);
    await this.evictIfNeeded();
  }

  async storePack(pack: LoadedPack): Promise<void> {
    await this.put({
      key: pack.entry.word_id,
      version: pack.entry.wordpack_version,
      manifestUrl: pack.manifestUrl,
      manifest: pack.manifest,
      wordpack: pack.wordpack,
      entry: pack.entry,
      storedAt: this.now(),
      lastUsedAt: this.now(),
    });
  }

  async listStored(): Promise<{ wordId: string; version: string }[]> {
    const all = this.useIdb ? await this.idbAll().catch(() => [...this.mem.values()]) : [...this.mem.values()];
    return all.map((r) => ({ wordId: r.key, version: r.version }));
  }

  async remove(wordId: string): Promise<void> {
    this.mem.delete(wordId);
    if (this.useIdb) await this.idbDelete(wordId).catch(() => void 0);
  }

  private async evictIfNeeded(): Promise<void> {
    const all = this.useIdb ? await this.idbAll().catch(() => [...this.mem.values()]) : [...this.mem.values()];
    if (all.length <= CONFIG.CACHE_MAX_PACKS) return;
    const sorted = all.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const victim of sorted.slice(0, all.length - CONFIG.CACHE_MAX_PACKS)) {
      await this.remove(victim.key);
    }
  }

  /** 자산(.riv/AAC/SVG)을 Cache Storage에 선행 로드 */
  async prefetchAssets(urls: string[], fetchFn: typeof fetch = (...args) => fetch(...args)): Promise<void> {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(CONTENT_CACHE);
    await Promise.allSettled(urls.map(async (u) => {
      const hit = await cache.match(u);
      if (hit) return;
      const res = await fetchFn(u);
      if (res.ok) await cache.put(u, res);
    }));
  }
}
