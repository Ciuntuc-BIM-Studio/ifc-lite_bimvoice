/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A placed slab's outline, reshaped (the plan's outline grips): the store
 * write (`setSlabOutlineInStore`) as one undo step, then the slab re-meshed
 * with its openings re-cut, for undo and redo too.
 */

import { setSlabOutlineInStore } from '@ifc-lite/create';
import { mutationDenial } from '../mutation-permission.js';
import { remeshAfterCommit } from '@/lib/remesh/remesh-registry';
import { modelEditTarget, recordModellingEdit, type ModellingStore } from './mutation-modelling-records.js';

export type SlabOutlineEdit = { ok: true } | { ok: false; reason: string };

/** Give slab `expressId` of `modelId` the outline `outline` (storey-local metres). */
export function reshapeSlabOutlineIn(store: ModellingStore, modelId: string, expressId: number, outline: readonly [number, number][]): SlabOutlineEdit {
  const get = store.getState;
  const denial = mutationDenial(get(), modelId);
  if (denial) return { ok: false, reason: denial };
  const target = modelEditTarget(get(), modelId);
  if (!target) return { ok: false, reason: `No model loaded for id "${modelId}"` };
  const undoBefore = get().undoStacks.get(modelId)?.length ?? 0;
  try {
    recordModellingEdit(store, modelId, (_methods, draft) => {
      const result = setSlabOutlineInStore({ ...target, view: draft.getMutationView(), editor: draft }, expressId, outline);
      if (!result.ok) throw new Error(result.reason);
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  // The batch `recordModellingEdit` just recorded: its last mutation's tag.
  const state = get();
  const stack = state.undoStacks.get(modelId) ?? [];
  const last = stack.length > undoBefore ? stack[stack.length - 1] : undefined;
  const batchId = last ? state.mutationBatchTags.get(last.id) ?? null : null;
  remeshAfterCommit(get, modelId, batchId, [expressId], 'hostsChanged');
  return { ok: true };
}
