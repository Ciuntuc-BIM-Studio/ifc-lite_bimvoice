/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bring a journalled session back (`journal.ts`): everything open is closed,
 * each model is loaded from the source it was loaded from, the project
 * document is put back, then each model's overlay, undo / redo history and
 * history metadata are restored, the elements it created are listed in the
 * spatial tree again, what it deleted leaves the scene and what it
 * re-shaped is re-meshed. The project stays unsaved.
 */

import type { Mutation, OverlaySnapshot } from '@ifc-lite/mutations';
import { effectiveStoreyId } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { restoreRemeshEntries } from '@/lib/remesh/remesh-registry';
import { loadProjectDocument, resetProject } from '../project-store';
import type { ModelLoader } from './project-open';
import { readJournalSource, type JournalEntry, type JournalModel } from './journal';

const ref = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

const reassign = (list: readonly Mutation[], modelId: string): Mutation[] => list.map((m) => ({ ...m, modelId }));

/** The ids `model`'s overlay changed the geometry of, and the products it deleted. */
function touched(model: JournalModel, overlay: OverlaySnapshot): { remesh: Set<number>; deleted: number[] } {
  const remesh = new Set<number>();
  for (const [, ids] of model.remesh) for (const id of ids) remesh.add(id);
  for (const [, id] of model.meshMoves) remesh.add(id);
  // A created product (it has a shape): re-meshed even when no batch remembered it.
  for (const [id, entity] of overlay.newEntities) if (ref(entity.attributes?.[6]) !== null && ref(entity.attributes?.[5]) !== null) remesh.add(id);
  return { remesh, deleted: [...overlay.tombstones] };
}

/** Put `model`'s journalled state on the model now loaded as `modelId`. */
function restoreModel(model: JournalModel, modelId: string): void {
  const get = useViewerStore.getState;
  const target = modelEditTarget(get(), modelId);
  if (!target || !model.overlay) return;
  const overlay = { ...model.overlay, mutationHistory: reassign(model.overlay.mutationHistory, modelId) };
  target.view.restoreOverlaySnapshot(overlay);
  const offset = get().models.get(modelId)?.idOffset ?? 0;
  useViewerStore.setState((s) => {
    const undoStacks = new Map(s.undoStacks).set(modelId, reassign(model.undo, modelId));
    const redoStacks = new Map(s.redoStacks).set(modelId, reassign(model.redo, modelId));
    const mutationBatchTags = new Map(s.mutationBatchTags);
    for (const [id, batch] of model.batchTags) mutationBatchTags.set(id, batch);
    const mutationMeshTranslations = new Map(s.mutationMeshTranslations);
    for (const [id, local, delta] of model.meshMoves) mutationMeshTranslations.set(id, { globalId: local + offset, rendererDelta: delta });
    return { undoStacks, redoStacks, mutationBatchTags, mutationMeshTranslations, mutationVersion: s.mutationVersion + 1 };
  });
  restoreRemeshEntries(get, modelId, model.remesh);

  // The spatial tree lists what the session created on a storey, as the authoring actions did.
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

  const { remesh, deleted } = touched(model, overlay);
  const toGlobal = (id: number) => toGlobalIdFromModels(get().models, modelId, id);
  if (deleted.length) get().setPendingMeshRemovals(new Set(deleted.map(toGlobal)));
  for (const id of deleted) remesh.delete(id);
  if (remesh.size) void requestRemesh(get, modelId, remesh, 'hostsChanged');
}

/** Restore `entry`; the names of the models whose source could not be loaded. */
export async function restoreJournal(entry: JournalEntry, loader: ModelLoader): Promise<string[]> {
  loader.clearAll();
  resetProject();
  const failed: string[] = [];
  const loaded: Array<{ model: JournalModel; id: string }> = [];
  for (const model of entry.models) {
    const blob = await readJournalSource(model.sessionId);
    const id = blob ? await loader.addModel(new File([blob], model.name || `${model.sessionId}.ifc`), { name: model.name }) : null;
    if (id) loaded.push({ model, id });
    else failed.push(model.name);
  }
  loadProjectDocument(entry.doc, { dirty: true });
  for (const { model, id } of loaded) restoreModel(model, id);
  return failed;
}
