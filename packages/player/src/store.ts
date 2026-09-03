/**
 * Local-first storage.
 *
 * Every move and every result lands here first and returns immediately. The
 * network is never on the critical path of a tap. IndexedDB rather than
 * localStorage because results are structured, there will eventually be
 * thousands of them, and localStorage writes block the main thread.
 */

import { resultKey, type PlayResult } from '@sussed/core';
import type { Identity, PlayerStorage } from './types';

const DB_NAME = 'sussed';
const DB_VERSION = 1;
const RESULTS = 'results';
const META = 'meta';

interface StoredResult extends PlayResult {
  key: string;
  syncedAt: number | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RESULTS)) {
        const store = db.createObjectStore(RESULTS, { keyPath: 'key' });
        store.createIndex('game', 'game');
        store.createIndex('syncedAt', 'syncedAt');
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * A memory-backed fallback. Private windows, storage-blocked browsers and
 * screenshot bots all hit this path — the game must still be playable, it just
 * forgets. Never let a storage failure break the board.
 */
function createMemoryStorage(): PlayerStorage {
  let identity: Identity | null = null;
  const results = new Map<string, StoredResult>();
  return {
    async getIdentity() {
      return identity;
    },
    async setIdentity(id) {
      identity = id;
    },
    async getResults(game) {
      const all = [...results.values()];
      return game ? all.filter((r) => r.game === game) : all;
    },
    async putResult(result) {
      results.set(resultKey(result), { ...result, key: resultKey(result), syncedAt: null });
      return result;
    },
    async getUnsynced() {
      return [...results.values()].filter((r) => r.syncedAt === null);
    },
    async markSynced(keys) {
      for (const k of keys) {
        const r = results.get(k);
        if (r) r.syncedAt = Date.now();
      }
    },
    async clear() {
      identity = null;
      results.clear();
    },
  };
}

export async function createStorage(): Promise<PlayerStorage> {
  let db: IDBDatabase;
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    db = await openDb();
  } catch {
    return createMemoryStorage();
  }

  const strip = (r: StoredResult): PlayResult => {
    const { key, syncedAt, ...rest } = r;
    void key;
    void syncedAt;
    return rest;
  };

  return {
    async getIdentity() {
      return (await tx<Identity | undefined>(db, META, 'readonly', (s) => s.get('identity'))) ?? null;
    },
    async setIdentity(id) {
      await tx(db, META, 'readwrite', (s) => s.put(id, 'identity'));
    },
    async getResults(game) {
      const all = await tx<StoredResult[]>(db, RESULTS, 'readonly', (s) => s.getAll());
      const filtered = game ? all.filter((r) => r.game === game) : all;
      return filtered.map(strip);
    },
    async putResult(result) {
      const key = resultKey(result);
      const existing = await tx<StoredResult | undefined>(db, RESULTS, 'readonly', (s) => s.get(key));
      // A solved result is immutable. This is the invariant that makes sync a
      // set merge instead of a conflict-resolution problem — guard it here.
      if (existing?.solved) return strip(existing);
      await tx(db, RESULTS, 'readwrite', (s) => s.put({ ...result, key, syncedAt: null }));
      return result;
    },
    async getUnsynced() {
      const all = await tx<StoredResult[]>(db, RESULTS, 'readonly', (s) => s.getAll());
      return all.filter((r) => r.syncedAt === null).map(strip);
    },
    async markSynced(keys) {
      const now = Date.now();
      for (const key of keys) {
        const existing = await tx<StoredResult | undefined>(db, RESULTS, 'readonly', (s) => s.get(key));
        if (existing) await tx(db, RESULTS, 'readwrite', (s) => s.put({ ...existing, syncedAt: now }));
      }
    },
    async clear() {
      await tx(db, RESULTS, 'readwrite', (s) => s.clear());
      await tx(db, META, 'readwrite', (s) => s.clear());
    },
  };
}
