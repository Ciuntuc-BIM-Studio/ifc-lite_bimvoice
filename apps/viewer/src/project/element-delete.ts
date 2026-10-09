/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Delete, the one way every surface removes model elements (the Delete key,
 * the context menu, the geometry card): the elements leave the model — not
 * a view — with what depends on them (`deletionClosure`: openings and what
 * fills them, an assembly's parts, a door's opening), their meshes leave
 * every view (3D, plans, sections, sheets), the geometry only they used is
 * pruned, cuts they made or took are redone, drafted contours linked to
 * them are unlinked — and one undo brings all of it back. A roof system
 * goes whole (a part on its own while the roof is edited as a block).
 */

import { deletionClosure, elementGeometryRefs, pruneOrphanOverlay, resolveAuthoringAnchor, syncCutsInStore } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { mutationDenial } from '@/store/mutation-permission';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { remeshAfterCommit } from '@/lib/remesh/remesh-registry';
import { setDraftParams } from '@/drafting/draft-store';
import { useProjectStore } from './project-store';
import { ensureEditMode } from './edit-mode';
import { roofPartOfRenderId, setPartOverride } from './roof-block';
import { deleteRoofSystem, roofSystemOfRenderId, type RoofSystemRef } from './roof-system-element';

export interface DeleteOutcome {
  /** Elements removed (dependants included). */
  deleted: number;
  /** Why some were not. */
  refused: string[];
}

function globalIdOf(modelId: string, expressId: number): string | null {
  const s = useViewerStore.getState();
  const created = s.mutationViews.get(modelId)?.getNewEntity(expressId)?.attributes[0];
  if (typeof created === 'string') return created;
  return s.models.get(modelId)?.ifcDataStore?.entities.getGlobalId(expressId) || null;
}

/** Delete elements of one model with their dependants, as one undo step. */
export function deleteModelElements(modelId: string, expressIds: readonly number[]): DeleteOutcome {
  const state = useViewerStore.getState();
  const denial = mutationDenial(state, modelId);
  if (denial) return { deleted: 0, refused: [denial] };
  const target = modelEditTarget(state, modelId);
  if (!target) return { deleted: 0, refused: ['The model is not loaded'] };
  const plan = deletionClosure(target.dataStore, expressIds, target.view);
  const refused = plan.refused.map((r) => r.reason);
  if (plan.ids.length === 0) return { deleted: 0, refused };
  // Read before removal: the geometry they own, and the GlobalIds drafted contours link by.
  const roots = plan.ids.flatMap((id) => elementGeometryRefs(target.editor, id));
  const guids = new Set(plan.ids.map((id) => globalIdOf(modelId, id)).filter((g): g is string => !!g));
  const before = useViewerStore.getState().undoStacks.get(modelId)?.length ?? 0;
  let deleted = 0;
  for (const id of plan.ids) if (useViewerStore.getState().removeEntity(modelId, id)) deleted++;
  const removals = (useViewerStore.getState().undoStacks.get(modelId) ?? []).slice(before).map((m) => m.id);
  let recut: number[] = [];
  try {
    recut = recordModellingCommit(useViewerStore, modelId, (draft, ds) => {
      pruneOrphanOverlay(draft, roots);
      // What they cut is whole again; what cut them stops.
      return syncCutsInStore(ds, draft, resolveAuthoringAnchor(ds, draft.getMutationView()), [], []).remesh;
    });
  } catch (err) {
    console.warn('[delete] could not prune the removed elements\' geometry', err);
  }
  // One undo step: the removals join the cleanup's batch.
  const after = useViewerStore.getState();
  const top = after.undoStacks.get(modelId)?.at(-1);
  const batchId = top ? after.mutationBatchTags.get(top.id) : undefined;
  if (batchId && removals.length) after.tagMutationBatch(removals, batchId);
  if (recut.length && batchId) remeshAfterCommit(useViewerStore.getState, modelId, batchId, recut, 'shape');
  else if (recut.length) void requestRemesh(useViewerStore.getState, modelId, recut, 'shape');
  // Contours drawn into these elements stay on their plans, unlinked.
  const linked = useProjectStore.getState().drafts.filter((d) => d.params.ifcModelId === modelId && guids.has(String(d.params.ifcGlobalId)));
  if (linked.length) setDraftParams(new Set(linked.map((d) => d.id)), { ifcGlobalId: null, ifcModelId: null, ifcClass: null, roofSystem: null });
  return { deleted, refused };
}

/** Delete what renderer ids stand for, across models. */
export function deleteElements(renderIds: readonly number[]): DeleteOutcome {
  const out: DeleteOutcome = { deleted: 0, refused: [] };
  if (renderIds.length === 0) return out;
  ensureEditMode();
  const s = useViewerStore.getState();
  const byModel = new Map<string, number[]>();
  const roofs = new Map<string, RoofSystemRef>();
  for (const id of renderIds) {
    // Inside a roof edited as a block, a part goes on its own (an override, Restore deleted brings it back).
    const part = roofPartOfRenderId(id);
    if (part) {
      const result = setPartOverride(part, { deleted: true });
      if (result.ok) out.deleted++;
      else out.refused.push(result.error);
      continue;
    }
    const roof = roofSystemOfRenderId(id);
    if (roof) { roofs.set(`${roof.modelId}:${roof.roofId}`, roof); continue; }
    const ref = s.resolveGlobalIdFromModels(id);
    if (ref) byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  for (const roof of roofs.values()) {
    const result = deleteRoofSystem(roof);
    if (result.ok) out.deleted++;
    else out.refused.push(result.error);
  }
  for (const [modelId, ids] of byModel) {
    const one = deleteModelElements(modelId, ids);
    out.deleted += one.deleted;
    out.refused.push(...one.refused);
  }
  useViewerStore.getState().setSelectedEntityIds([]);
  useViewerStore.getState().setSelectedEntityId(null);
  return out;
}

/** The current selection's renderer ids (the inspected one included). */
export function selectedRenderIds(): number[] {
  const s = useViewerStore.getState();
  const ids = new Set<number>(s.selectedEntityIds ?? []);
  if (typeof s.selectedEntityId === 'number') ids.add(s.selectedEntityId);
  return [...ids];
}
