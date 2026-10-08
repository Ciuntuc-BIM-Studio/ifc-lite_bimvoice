/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Deleting an element together with what only it used: `removeEntity`
 * takes the element out, then its placement and body records (points,
 * faces, profiles, styled items…) are pruned when nothing else points to
 * them — tagged into the same undo step, so one undo brings all of it back.
 */

import { elementGeometryRefs, pruneOrphanOverlay } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';

export function removeElementWithOrphans(modelId: string, expressId: number): boolean {
  const state = useViewerStore.getState();
  const editor = modelEditTarget(state, modelId)?.editor;
  const roots = editor ? elementGeometryRefs(editor, expressId) : [];
  if (!state.removeEntity(modelId, expressId)) return false;
  if (roots.length === 0) return true;
  const removal = useViewerStore.getState().undoStacks.get(modelId)?.at(-1);
  try {
    recordModellingCommit(useViewerStore, modelId, (draft) => pruneOrphanOverlay(draft, roots));
  } catch (err) {
    // The element is gone either way; its leftovers just stay until export.
    console.warn('[element-removal] could not prune the removed element\'s geometry', err);
    return true;
  }
  const after = useViewerStore.getState();
  const top = after.undoStacks.get(modelId)?.at(-1);
  const batchId = top && top !== removal ? after.mutationBatchTags.get(top.id) : undefined;
  if (removal && batchId) after.tagMutationBatch([removal.id], batchId);
  return true;
}
