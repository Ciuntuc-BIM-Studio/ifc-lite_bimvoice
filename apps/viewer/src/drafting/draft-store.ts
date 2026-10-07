/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Drafted entities live in the project document (`useProjectStore.drafts`,
 * saved with the project). Every edit goes through `commitDrafts`, which
 * records the previous array for undo — the arrays are immutable, so a
 * history step costs one reference, not a copy.
 */

import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import type { DraftEntity, DraftParamValue, DraftShape } from './types';

const HISTORY_LIMIT = 200;

let past: DraftEntity[][] = [];
let future: DraftEntity[][] = [];

/** Replace the drafts with `next`, as one undoable step. */
export function commitDrafts(next: DraftEntity[]): void {
  const current = useProjectStore.getState().drafts;
  if (next === current) return;
  past = [...past.slice(-(HISTORY_LIMIT - 1)), current];
  future = [];
  useProjectStore.setState({ drafts: next, dirty: true });
}

export function undoDrafts(): boolean {
  const previous = past.at(-1);
  if (!previous) return false;
  past = past.slice(0, -1);
  future = [...future, useProjectStore.getState().drafts];
  useProjectStore.setState({ drafts: previous, dirty: true });
  return true;
}

export function redoDrafts(): boolean {
  const next = future.at(-1);
  if (!next) return false;
  future = future.slice(0, -1);
  past = [...past, useProjectStore.getState().drafts];
  useProjectStore.setState({ drafts: next, dirty: true });
  return true;
}

/** Forget the history (another project was loaded). */
export function clearDraftHistory(): void {
  past = [];
  future = [];
}

export function draftsOfView(viewId: string, drafts: readonly DraftEntity[] = useProjectStore.getState().drafts): DraftEntity[] {
  return drafts.filter((d) => d.viewId === viewId);
}

export function newDraft(viewId: string, layerId: string, shape: DraftShape, params: Record<string, DraftParamValue> = {}): DraftEntity {
  return { id: freshProjectId('draft'), viewId, layerId, shape, params };
}

/**
 * One edit: drop `remove`, swap shapes of `update` (same id, same params),
 * append `add`. Returns the ids of the added entities.
 */
export function editDrafts(edit: {
  add?: DraftEntity[];
  update?: ReadonlyMap<string, DraftShape>;
  remove?: ReadonlySet<string>;
}): string[] {
  const { drafts } = useProjectStore.getState();
  const remove = edit.remove ?? new Set<string>();
  const update = edit.update ?? new Map<string, DraftShape>();
  const next = drafts
    .filter((d) => !remove.has(d.id))
    .map((d) => {
      const shape = update.get(d.id);
      return shape ? { ...d, shape } : d;
    });
  const added = edit.add ?? [];
  if (added.length === 0 && remove.size === 0 && update.size === 0) return [];
  commitDrafts([...next, ...added]);
  return added.map((d) => d.id);
}

export function setDraftParams(ids: ReadonlySet<string>, params: Record<string, DraftParamValue | null>): void {
  const { drafts } = useProjectStore.getState();
  commitDrafts(drafts.map((d) => {
    if (!ids.has(d.id)) return d;
    const merged: Record<string, DraftParamValue> = { ...d.params };
    for (const [key, value] of Object.entries(params)) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    return { ...d, params: merged };
  }));
}
