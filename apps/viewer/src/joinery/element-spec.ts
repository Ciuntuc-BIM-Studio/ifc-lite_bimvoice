/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The configured joinery type behind a door or window on screen: renderer id
 * → model element → its IfcDoorType / IfcWindowType → the spec stored on it
 * (`readJoineryType`). Read through the mutation overlay; memoised per model
 * until that model's overlay changes.
 */

import { readJoineryFlips, readJoineryType, type JoineryTypeRead } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { typeOf } from '@/lib/commands/modeling/authored-kinds';

/** A configured element: its type, and how it is turned in its opening (`emitMappedBody`'s flips). */
export interface JoineryElement extends JoineryTypeRead {
  flips: number;
}

interface ModelMemo {
  stamp: string;
  byElement: Map<number, JoineryElement | null>;
}

const memo = new Map<string, ModelMemo>();

/** Forget what was read (a type was rewritten). */
export function invalidateJoineryReads(modelId?: string): void {
  if (modelId) memo.delete(modelId);
  else memo.clear();
}

/** The joinery type of element `expressId` in `modelId`, or null when it has none configured. */
export function joineryOfElement(modelId: string, expressId: number): JoineryElement | null {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return null;
  const view = s.mutationViews.get(modelId) ?? null;
  const stamp = view ? `${view.getMutationCount()}:${view.getNewEntities().length}` : '-';
  let m = memo.get(modelId);
  if (!m || m.stamp !== stamp) {
    m = { stamp, byElement: new Map() };
    memo.set(modelId, m);
  }
  if (m.byElement.has(expressId)) return m.byElement.get(expressId) ?? null;
  let read: JoineryElement | null = null;
  try {
    const typeId = typeOf({ dataStore, view }, expressId);
    const type = typeId === null ? null : readJoineryType(dataStore, typeId, view);
    read = type ? { ...type, flips: readJoineryFlips(dataStore, expressId, view) } : null;
  } catch {
    read = null;
  }
  m.byElement.set(expressId, read);
  return read;
}

/** The same, by renderer (federation-global) id. */
export function joineryOfRenderId(id: number): JoineryElement | null {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(id);
  return ref ? joineryOfElement(ref.modelId, ref.expressId) : null;
}
