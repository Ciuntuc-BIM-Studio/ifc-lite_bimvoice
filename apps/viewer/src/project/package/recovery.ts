/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Crash recovery: a copy of the open project, as a package, kept in the
 * browser's IndexedDB (no localStorage size limit) while it has unsaved
 * changes. One slot: the last project worked on. A Save, or opening another
 * project, clears it; at startup a slot left behind is offered back.
 */

const DB = 'bimvoice-projects';
const STORE = 'recovery';
const SLOT = 'current';

export interface RecoveryEntry {
  projectId: string;
  name: string;
  fileName: string | null;
  savedAt: number;
  bytes: Blob;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close();
  }
}

export async function writeRecovery(entry: RecoveryEntry): Promise<void> {
  await run('readwrite', (s) => s.put(entry, SLOT));
}

export async function readRecovery(): Promise<RecoveryEntry | null> {
  try {
    const entry = await run<RecoveryEntry | undefined>('readonly', (s) => s.get(SLOT) as IDBRequest<RecoveryEntry | undefined>);
    return entry && entry.bytes instanceof Blob ? entry : null;
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  try { await run('readwrite', (s) => s.delete(SLOT)); } catch { /* nothing to clear */ }
}
