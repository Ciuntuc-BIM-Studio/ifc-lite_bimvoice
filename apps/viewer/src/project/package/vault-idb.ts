/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The browser's project storage (IndexedDB `bimvoice-projects`): the
 * recovery slot, the content-addressed parts and the version records — the
 * vault `versions.ts` works over. Parts are stored as Blobs (disk-backed).
 */

import type { ProjectVault, VersionRecord } from './versions';

const DB = 'bimvoice-projects';
const VERSION = 2;
export const STORES = { recovery: 'recovery', blobs: 'blobs', versions: 'versions' } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

export function openProjectDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      for (const name of Object.values(STORES)) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

export async function idbRun<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openProjectDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close();
  }
}

const versionKey = (projectId: string, id: string) => `${projectId}:${id}`;

export const idbVault: ProjectVault = {
  hasBlob: async (sha) => (await idbRun<IDBValidKey | undefined>(STORES.blobs, 'readonly', (s) => s.getKey(sha))) !== undefined,
  putBlob: async (sha, bytes) => { await idbRun(STORES.blobs, 'readwrite', (s) => s.put(new Blob([bytes as BlobPart]), sha)); },
  getBlob: async (sha) => {
    const blob = await idbRun<Blob | undefined>(STORES.blobs, 'readonly', (s) => s.get(sha) as IDBRequest<Blob | undefined>);
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  },
  putVersion: async (record) => { await idbRun(STORES.versions, 'readwrite', (s) => s.put(record, versionKey(record.projectId, record.id))); },
  listVersions: async (projectId) => {
    const range = IDBKeyRange.bound(`${projectId}:`, `${projectId}:￿`);
    const all = await idbRun<VersionRecord[]>(STORES.versions, 'readonly', (s) => s.getAll(range) as IDBRequest<VersionRecord[]>);
    return all.sort((a, b) => a.number - b.number);
  },
  deleteVersion: async (projectId, id) => { await idbRun(STORES.versions, 'readwrite', (s) => s.delete(versionKey(projectId, id))); },
};
