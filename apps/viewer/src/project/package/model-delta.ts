/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A model's edits over the IFC it was loaded from (N4b): its overlay
 * (`MutablePropertyView.captureOverlaySnapshot`), the moves applied to its
 * meshes, and which elements no longer look as the IFC draws them. Saved
 * beside that IFC in a package, so a Save writes only this, not the whole
 * model again; restored the way the journal restores a session (N5), which
 * keeps the same record with its undo history.
 *
 * `touched` is cumulative: what an earlier session restored from a package
 * still differs from the IFC, so it is carried into the next save.
 */

import { MutablePropertyView, type Mutation, type OverlaySnapshot } from '@ifc-lite/mutations';
import { effectiveStoreyId } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import type { ViewerState } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { restoreRemeshEntries } from '@/lib/remesh/remesh-registry';
import { observeRemeshRequests, requestRemesh } from '@/lib/remesh/remesh-service';
import type { RemeshCause } from '@/lib/remesh/affected-set';

export type MeshMove = [mutationId: string, localId: number, delta: [number, number, number]];
export type RemeshEntry = [batchId: string, ids: readonly number[], cause: RemeshCause];

export interface ModelDelta {
  overlay: OverlaySnapshot;
  /** The id offset of the session that captured it (mesh moves are keyed globally there). */
  idOffset: number;
  meshMoves: MeshMove[];
  /** Model-local ids whose geometry differs from the IFC's (re-meshed on restore). */
  touched: number[];
}

/** The history-bound records `restoreModelDelta` also puts back (the journal's undo / redo). */
export interface DeltaHistory {
  undo: Mutation[];
  redo: Mutation[];
  batchTags: Array<[string, string]>;
  remesh: RemeshEntry[];
}

/**
 * Per loaded model, the ids re-meshed since it was loaded (every re-mesh
 * request, undo and restore included) and those a restored delta carried:
 * together, what no longer looks as its IFC draws it.
 */
const carried = new Map<string, Set<number>>();
observeRemeshRequests((_get, modelId, ids) => {
  let set = carried.get(modelId);
  if (!set) carried.set(modelId, (set = new Set()));
  for (const id of ids) set.add(id);
});

const ref = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** `modelId`'s edits now (none: an empty overlay); null for a model not loaded. */
export function captureModelDelta(s: ViewerState, modelId: string): ModelDelta | null {
  const model = s.models.get(modelId);
  if (!model) return null;
  const view = s.mutationViews.get(modelId) ?? new MutablePropertyView(null, modelId);
  const ids = new Set([...(s.undoStacks.get(modelId) ?? []), ...(s.redoStacks.get(modelId) ?? [])].map((x) => x.id));
  const offset = model.idOffset ?? 0;
  const meshMoves: MeshMove[] = [...s.mutationMeshTranslations].filter(([id]) => ids.has(id))
    .map(([id, t]) => [id, t.globalId - offset, [...t.rendererDelta] as [number, number, number]]);
  const touched = new Set(carried.get(modelId) ?? []);
  for (const [, id] of meshMoves) touched.add(id);
  return { overlay: view.captureOverlaySnapshot(), idOffset: offset, meshMoves, touched: [...touched] };
}

/** What `delta` re-meshes on restore, and the products it deleted. */
function affected(delta: ModelDelta, history: DeltaHistory | undefined): { remesh: Set<number>; deleted: number[] } {
  const remesh = new Set<number>(delta.touched);
  for (const [, ids] of history?.remesh ?? []) for (const id of ids) remesh.add(id);
  for (const [, id] of delta.meshMoves) remesh.add(id);
  // A created product (it has a shape): re-meshed even when no batch remembered it.
  for (const [id, entity] of delta.overlay.newEntities) if (ref(entity.attributes?.[6]) !== null && ref(entity.attributes?.[5]) !== null) remesh.add(id);
  return { remesh, deleted: [...delta.overlay.tombstones] };
}

const reassign = (list: readonly Mutation[], modelId: string): Mutation[] => list.map((m) => ({ ...m, modelId }));

/**
 * Put `delta` on the model loaded as `modelId` (over the same IFC): its
 * overlay, history (when given), the elements it created listed in the
 * spatial tree, what it deleted out of the scene, what it re-shaped re-meshed.
 */
export function restoreModelDelta(delta: ModelDelta, modelId: string, history?: DeltaHistory): void {
  const get = useViewerStore.getState;
  const target = modelEditTarget(get(), modelId);
  if (!target) return;
  const overlay = { ...delta.overlay, mutationHistory: reassign(delta.overlay.mutationHistory, modelId) };
  target.view.restoreOverlaySnapshot(overlay);
  const offset = get().models.get(modelId)?.idOffset ?? 0;
  useViewerStore.setState((s) => {
    const undoStacks = new Map(s.undoStacks).set(modelId, reassign(history?.undo ?? [], modelId));
    const redoStacks = new Map(s.redoStacks).set(modelId, reassign(history?.redo ?? [], modelId));
    const mutationBatchTags = new Map(s.mutationBatchTags);
    for (const [id, batch] of history?.batchTags ?? []) mutationBatchTags.set(id, batch);
    const mutationMeshTranslations = new Map(s.mutationMeshTranslations);
    for (const [id, local, d] of delta.meshMoves) mutationMeshTranslations.set(id, { globalId: local + offset, rendererDelta: d });
    return { undoStacks, redoStacks, mutationBatchTags, mutationMeshTranslations, mutationVersion: s.mutationVersion + 1 };
  });
  if (history) restoreRemeshEntries(get, modelId, history.remesh);
  const known = carried.get(modelId) ?? new Set<number>();
  for (const id of delta.touched ?? []) known.add(id);
  carried.set(modelId, known);

  // The spatial tree lists what was created on a storey, as the authoring actions did.
  const hierarchy = target.dataStore.spatialHierarchy;
  if (hierarchy) {
    for (const [id, entity] of overlay.newEntities) {
      if (ref(entity.attributes?.[5]) === null) continue; // not a placed product
      const storey = effectiveStoreyId(target.dataStore, target.view, id);
      if (storey === undefined || !hierarchy.storeyElevations.has(storey)) continue;
      const name = entity.attributes[2];
      registerAuthoredElement(hierarchy, storey, id, entity.type, typeof name === 'string' ? name : '');
    }
  }

  const { remesh, deleted } = affected(delta, history);
  const toGlobal = (id: number) => toGlobalIdFromModels(get().models, modelId, id);
  if (deleted.length) get().setPendingMeshRemovals(new Set(deleted.map(toGlobal)));
  for (const id of deleted) remesh.delete(id);
  if (remesh.size) void requestRemesh(get, modelId, remesh, 'hostsChanged');
}

/** Forget what restored deltas carried (everything open was closed). */
export function clearCarriedDeltas(): void {
  carried.clear();
}
