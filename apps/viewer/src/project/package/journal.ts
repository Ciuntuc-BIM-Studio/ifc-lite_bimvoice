/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The edit journal (N5, docs/format-lapin-nativ.md): what the open project
 * is, kept in the browser after every change, in milliseconds. Not a
 * re-export: each edited model is its source as loaded (written once per
 * load) plus its overlay — what the session changed over that source
 * (`MutablePropertyView.captureOverlaySnapshot`) — with its undo / redo
 * history; and the project document. Restoring it (`journal-restore.ts`)
 * loads the sources, puts the overlays and the history back and re-meshes
 * what they touched, so an unsaved session comes back as it was, undo
 * included.
 *
 * One slot (the session's) in the `journal` store; the sources sit beside
 * it under `src:<model id>` and go with it. A Save, or opening a project,
 * clears it. A model whose source is not resident (a streamed source) is
 * not journalled: the slow full-package recovery copy covers it.
 */

import { useViewerStore } from '@/store';
import type { ViewerState } from '@/store';
import { remeshEntriesOf } from '@/lib/remesh/remesh-registry';
import { captureModelDelta, type DeltaHistory, type ModelDelta } from './model-delta';
import { projectDocument } from '../project-store';
import type { ProjectDocument } from '../types';
import { idbRun, STORES } from './vault-idb';

const SLOT = 'current';

/** One model: its edits over its source (`model-delta.ts`) with their undo / redo history. */
export interface JournalModel extends ModelDelta, DeltaHistory {
  /** The model's id in the session that wrote the journal (its source's key). */
  sessionId: string;
  name: string;
}

export interface JournalEntry {
  projectId: string;
  name: string;
  fileName: string | null;
  at: number;
  doc: ProjectDocument;
  models: JournalModel[];
}

const run = <T,>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => idbRun(STORES.journal, mode, fn);
const sourceKey = (sessionId: string) => `src:${sessionId}`;

/** Sources already in the journal store, by session model id. */
const written = new Set<string>();

/** The models a journal covers: the session's own (not linked), each with a resident source. */
function journalModels(s: ViewerState) {
  return [...s.models.values()].filter((m) => !m.linked && m.ifcDataStore?.source?.isResident && m.ifcDataStore.source.byteLength > 0);
}

/** Whether every model of the open project can be journalled (else the full recovery copy is the fallback). */
export function journalCovers(s: ViewerState = useViewerStore.getState()): boolean {
  const own = [...s.models.values()].filter((m) => !m.linked);
  return own.length > 0 && journalModels(s).length === own.length;
}

/** The entry for the open project now (synchronous: what `writeJournal` stores). */
export function captureJournal(s: ViewerState, session: { projectId: string; fileName: string | null }): JournalEntry {
  const models: JournalModel[] = journalModels(s).flatMap((m) => {
    const delta = captureModelDelta(s, m.id);
    if (!delta) return [];
    const undo = s.undoStacks.get(m.id) ?? [];
    const redo = s.redoStacks.get(m.id) ?? [];
    const ids = new Set([...undo, ...redo].map((x) => x.id));
    return [{
      ...delta, sessionId: m.id, name: m.name,
      undo: structuredClone(undo), redo: structuredClone(redo),
      batchTags: [...s.mutationBatchTags].filter(([id]) => ids.has(id)),
      remesh: remeshEntriesOf(useViewerStore.getState, m.id).map(([b, e, c]) => [b, [...e], c]),
    }];
  });
  const doc = projectDocument();
  return { projectId: session.projectId, name: doc.name, fileName: session.fileName, at: Date.now(), doc: structuredClone(doc), models };
}

/** No write yet in this page: a journal left by an earlier session is replaced whole, sources and all. */
let firstWrite = true;

/** Store `entry`, with each model's source the first time it is journalled. */
export async function writeJournal(entry: JournalEntry): Promise<void> {
  if (firstWrite) {
    firstWrite = false;
    await run('readwrite', (store) => store.clear());
  }
  const s = useViewerStore.getState();
  for (const m of entry.models) {
    if (written.has(m.sessionId)) continue;
    const source = s.models.get(m.sessionId)?.ifcDataStore?.source;
    if (!source) continue;
    const blob = await source.withMaterializedAsync(async (bytes) => new Blob([bytes.slice() as BlobPart]));
    await run('readwrite', (store) => store.put(blob, sourceKey(m.sessionId)));
    written.add(m.sessionId);
  }
  await run('readwrite', (store) => store.put(entry, SLOT));
}

export async function readJournal(): Promise<JournalEntry | null> {
  try {
    const entry = await run<JournalEntry | undefined>('readonly', (s) => s.get(SLOT) as IDBRequest<JournalEntry | undefined>);
    return entry && Array.isArray(entry.models) && entry.models.length > 0 ? entry : null;
  } catch {
    return null;
  }
}

/** The source a journalled model was loaded from. */
export async function readJournalSource(sessionId: string): Promise<Blob | null> {
  try {
    const blob = await run<Blob | undefined>('readonly', (s) => s.get(sourceKey(sessionId)) as IDBRequest<Blob | undefined>);
    return blob instanceof Blob ? blob : null;
  } catch {
    return null;
  }
}

/**
 * Drop the journal (an open, a discarded recovery). After a Save the models
 * still read over the same sources, so `keepSources` leaves those in place.
 */
export async function clearJournal(options: { keepSources?: boolean } = {}): Promise<void> {
  try {
    if (options.keepSources) await run('readwrite', (s) => s.delete(SLOT));
    else { written.clear(); firstWrite = false; await run('readwrite', (s) => s.clear()); }
  } catch { /* nothing to clear */ }
}
