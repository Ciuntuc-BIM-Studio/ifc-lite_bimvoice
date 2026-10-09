/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Relocating the selection (`@ifc-lite/create`'s element-relocate), one
 * undo step each:
 *
 * - to another storey of its model, kept relative to the storey (it moves
 *   with the level) or kept where it is in space. Groups come whole (the
 *   selection already holds every member), a roof system or a corridor
 *   with its parts, doors and windows with their walls;
 * - by a new placement of one element: offsets and angles about X, Y, Z in
 *   its parent's frame.
 *
 * Edit mode turns on by itself, as for every authoring tool.
 */

import { create } from 'zustand';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { moveElementsToStoreyInStore, readElementPlacement, type ElementPlacement, setElementPlacementInStore, type PlacementTransform, type StoreyKeep } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { expandAffectedSet } from '@/lib/remesh/affected-set';
import { modelStoreys, type WorkspaceStorey } from '@/lib/commands/modeling/workspace-storeys';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { ensureEditMode } from './edit-mode';
import { modelLevels } from './model-levels';

/** The selection by model, express ids. */
export function selectionByModel(): Map<string, number[]> {
  const s = useViewerStore.getState();
  const ids = new Set(s.selectedEntityIds);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const out = new Map<string, number[]>();
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (ref) out.set(ref.modelId, [...(out.get(ref.modelId) ?? []), ref.expressId]);
  }
  return out;
}

/** A model's storeys, lowest first, named as the project shows them (storeys added this session too). */
export function storeysOf(modelId: string): WorkspaceStorey[] {
  const names = new Map(modelLevels(modelId).map((l) => [l.expressId, l.name]));
  return modelStoreys(useViewerStore.getState(), modelId).map((s) => ({ ...s, name: names.get(s.expressId) ?? s.name }));
}

export type RelocateResult = { ok: true; moved: number } | { ok: false; error: string };

/** Move elements of one model to one of its storeys. */
export function moveToStorey(modelId: string, ids: readonly number[], storeyId: number, keep: StoreyKeep): RelocateResult {
  if (!ids.length) return { ok: false, error: 'Nothing selected' };
  ensureEditMode();
  let moved: number[] = [];
  const ok = runInspectorEdit(modelId, (tx) => {
    const done = recordModellingCommit(useViewerStore, tx.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      const result = moveElementsToStoreyInStore(ds, editor, ids, storeyId, keep);
      return { ...result, remesh: [...expandAffectedSet(ds, editor.getMutationView(), result.moved, 'hostsChanged')] };
    });
    moved = done.moved;
    // The loaded hierarchy, for what still reads it (the properties' storey badge).
    const hierarchy = useViewerStore.getState().models.get(tx.modelId)?.ifcDataStore?.spatialHierarchy;
    if (hierarchy) for (const id of moved) if (hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, storeyId);
    return done.remesh;
  });
  return ok ? { ok: true, moved: moved.length } : { ok: false, error: 'refused' };
}

/** One element's placement in its parent's frame (offsets in metres, angles in degrees); null when it has none. */
export function elementPlacement(modelId: string, id: number): ElementPlacement | null {
  const s = useViewerStore.getState();
  const ds = s.models.get(modelId)?.ifcDataStore;
  // No edits yet: the model as loaded.
  const view = s.mutationViews.get(modelId) ?? new MutablePropertyView(null, 'm');
  if (!ds) return null;
  try {
    // Reading needs only the editor's view of the model.
    return readElementPlacement(ds, { getMutationView: () => view }, id);
  } catch {
    return null;
  }
}

export function setPlacement(modelId: string, id: number, next: PlacementTransform): boolean {
  ensureEditMode();
  return runInspectorEdit(modelId, (tx) => recordModellingCommit(useViewerStore, tx.modelId, (editor, ds) => {
    const changed = setElementPlacementInStore(ds, editor, id, next);
    return [...expandAffectedSet(ds, editor.getMutationView(), changed, 'hostsChanged')];
  }));
}

/** The Move to storey dialog: which model's selection it is on. */
export const useMoveToStoreyDialog = create<{ open: boolean }>()(() => ({ open: false }));
export const openMoveToStorey = () => useMoveToStoreyDialog.setState({ open: true });
