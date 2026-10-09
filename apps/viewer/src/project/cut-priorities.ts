/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cut priorities between structural elements (`@ifc-lite/create`'s
 * cut-priority) in the viewer:
 *
 * - every modelling commit re-cuts the structural elements it created or
 *   changed, in its own undo step (`registerCommitFollowUp`), so a column
 *   placed in a wall cuts it at once and moving it re-cuts;
 * - "Cut priorities" applies them to the selection, or to the whole model
 *   when nothing is selected (models loaded from a file carry none);
 * - an element's own priority is edited in the Model inspector.
 *
 * Only elements on the same storey and the ones next to it are tried, so a
 * commit costs what that neighbourhood costs, not the model.
 */

import { CUT_PRIORITY_PROP, CUT_PRIORITY_PSET, cutParticipants, cutPriorityOf, resolveAuthoringAnchor, syncCutsInStore } from '@ifc-lite/create';
import { PropertyValueType } from '@ifc-lite/data';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { registerCommitFollowUp } from '@/lib/commands/modeling/transaction';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { ensureEditMode } from '@/project/edit-mode';

function live(modelId: string) {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  return dataStore ? { dataStore, view: s.mutationViews.get(modelId) ?? null } : null;
}

/** The structural elements on the storeys of `ids` and the storeys either side. */
function neighbourhood(modelId: string, ids: readonly number[]): number[] | undefined {
  const m = live(modelId);
  const hierarchy = m?.dataStore.spatialHierarchy;
  if (!m || !hierarchy) return undefined;
  const byElevation = [...hierarchy.storeyElevations.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const near = new Set<number>();
  for (const id of ids) {
    const storey = hierarchy.elementToStorey.get(id);
    if (storey === undefined) return undefined;
    const at = byElevation.indexOf(storey);
    for (const k of [at - 1, at, at + 1]) if (k >= 0 && k < byElevation.length) near.add(byElevation[k]);
  }
  return cutParticipants(m.dataStore, m.view).filter((id) => {
    const storey = hierarchy.elementToStorey.get(id);
    return storey === undefined || near.has(storey);
  });
}

/** Re-cut `ids` (one model) inside the caller's transaction. The ids to re-mesh. */
export function recutElements(modelId: string, ids: readonly number[], everywhere = false): number[] {
  const m = live(modelId);
  if (!m) return [];
  const structural = ids.filter((id) => cutPriorityOf(m.dataStore, id, m.view) !== null);
  if (structural.length === 0) return [];
  const candidates = everywhere ? undefined : neighbourhood(modelId, structural);
  return recordModellingCommit(useViewerStore, modelId, (editor, ds) =>
    syncCutsInStore(ds, editor, resolveAuthoringAnchor(ds, editor.getMutationView()), structural, candidates)).remesh;
}

// Whatever a modelling command builds or reshapes is re-cut in the same step.
registerCommitFollowUp((_store, modelId, result) => {
  const ids = [...new Set([...result.created, ...result.remesh])];
  try {
    return recutElements(modelId, ids);
  } catch (err) {
    // The command's own edit stands; its cuts wait for the next one.
    console.warn('[cut-priorities] could not re-cut after the commit', err);
    return [];
  }
});

/** Apply cut priorities to the selection, or to every structural element of every model when nothing is selected. */
export function applyCutPriorities(): { models: number; elements: number; attempted: number } {
  ensureEditMode();
  const s = useViewerStore.getState();
  const picked = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) picked.add(s.selectedEntityId);
  const byModel = new Map<string, number[]>();
  for (const id of picked) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (ref) byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  if (picked.size === 0) {
    for (const [modelId] of s.models) {
      const m = live(modelId);
      if (m) byModel.set(modelId, cutParticipants(m.dataStore, m.view));
    }
  }
  let elements = 0, models = 0, attempted = 0;
  for (const [modelId, ids] of byModel) {
    attempted += ids.length;
    if (runInspectorEdit(modelId, () => recutElements(modelId, ids, picked.size === 0))) {
      models++;
      elements += ids.length;
    }
  }
  return { models, elements, attempted };
}

/** An element's own cut priority (0 … 100), or back to its class's (null); re-cuts it, one undo step. */
export function setCutPriority(modelId: string, expressId: number, priority: number | null): boolean {
  ensureEditMode();
  return runInspectorEdit(modelId, (tx) => {
    if (priority === null) tx.store.deleteProperty(modelId, expressId, CUT_PRIORITY_PSET, CUT_PRIORITY_PROP);
    else tx.store.setProperty(modelId, expressId, CUT_PRIORITY_PSET, CUT_PRIORITY_PROP, Math.round(Math.max(0, Math.min(100, priority))), PropertyValueType.Integer);
    return [expressId, ...recutElements(modelId, [expressId])];
  });
}
