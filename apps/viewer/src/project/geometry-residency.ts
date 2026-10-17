/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry kept in memory or not, by group (a storey, an IFC class in it):
 * "Unload geometry" drops the elements' meshes from the scene (GPU) and from
 * the models' geometry (`setPendingMeshRemovals`, drained by
 * `useMeshEditDrain`); they stay in the model — properties, selection in the
 * tree, export — only not drawn. "Load geometry" meshes them again from the
 * model (`requestRemesh`). Session state, by renderer id.
 */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { requestRemesh } from '@/lib/remesh/remesh-service';

interface ResidencyState {
  /** Renderer ids whose geometry is unloaded. */
  unloaded: ReadonlySet<number>;
}

export const useGeometryResidency = create<ResidencyState>(() => ({ unloaded: new Set() }));

/** The row action a group of elements (renderer ids) takes: unload while any is loaded, else load. */
export function residencyActions(ids: readonly number[]): Array<'unload' | 'load'> {
  if (ids.length === 0) return [];
  const { unloaded } = useGeometryResidency.getState();
  return [ids.every((id) => unloaded.has(id)) ? 'load' : 'unload'];
}

/** Whether the element drawn as `renderId` has its geometry unloaded. */
export const isUnloaded = (renderId: number): boolean => useGeometryResidency.getState().unloaded.has(renderId);

/** Unload (`load` false) or load the geometry of `ids` (renderer ids). */
export function setGeometryLoaded(ids: readonly number[], load: boolean): void {
  const s = useViewerStore.getState();
  const unloaded = new Set(useGeometryResidency.getState().unloaded);
  if (!load) {
    const drop = ids.filter((id) => !unloaded.has(id));
    if (drop.length === 0) return;
    for (const id of drop) unloaded.add(id);
    useGeometryResidency.setState({ unloaded });
    s.setPendingMeshRemovals(new Set(drop));
    return;
  }
  const byModel = new Map<string, number[]>();
  for (const id of ids) {
    if (!unloaded.delete(id)) continue;
    const ref = s.resolveGlobalIdFromModels(id);
    if (!ref) continue;
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  useGeometryResidency.setState({ unloaded });
  for (const [modelId, expressIds] of byModel) void requestRemesh(useViewerStore.getState, modelId, expressIds, 'shape');
}
