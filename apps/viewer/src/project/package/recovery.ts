/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Crash recovery: a copy of the open project, as a package, kept in the
 * browser's IndexedDB (no localStorage size limit) while it has unsaved
 * changes. One slot: the last project worked on. A Save, or opening another
 * project, clears it; at startup a slot left behind is offered back.
 */

import { idbRun, STORES } from './vault-idb';

const SLOT = 'current';

export interface RecoveryEntry {
  projectId: string;
  name: string;
  fileName: string | null;
  savedAt: number;
  bytes: Blob;
}

const run = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => idbRun(STORES.recovery, mode, fn);

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
