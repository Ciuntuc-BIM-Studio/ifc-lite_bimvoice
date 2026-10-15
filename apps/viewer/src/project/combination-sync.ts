/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Live Union / Intersect in the app (`@ifc-lite/create`'s element-combine):
 *
 *  - when a tool or a target of a live combination changes shape (a re-mesh
 *    is asked for it), the target's body is written again from the tools as
 *    they are, in the same undo step, and re-meshed;
 *  - the tools are elements of their own but drawn as part of the target:
 *    hidden in the views (when a model loads, when they are tied), shown for
 *    editing by "Show operands", hidden again by it;
 *  - undo and redo commit nothing: they restore the body with the step, and
 *    the tools are shown or hidden as the restored ties say.
 */

import { readCombinations, rebakeCombinationInStore } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { observeRemeshRequests, requestRemesh } from '@/lib/remesh/remesh-service';
import { remeshIsReplay } from '@/lib/remesh/remesh-registry';

let rebaking = false;

/** Run `fn` (a combine or separate that writes the bodies itself) without following its re-mesh. */
export function withoutFollowing<T>(fn: () => T): T {
  const was = rebaking;
  rebaking = true;
  try { return fn(); } finally { rebaking = was; }
}

function combinationsOf(modelId: string, ids?: ReadonlySet<number>) {
  const target = modelEditTarget(useViewerStore.getState(), modelId);
  return target ? readCombinations(target.dataStore, target.view, ids) : [];
}

const renderIds = (modelId: string, ids: Iterable<number>) => {
  const { models } = useViewerStore.getState();
  return [...ids].map((id) => toGlobalIdFromModels(models, modelId, id));
};

/** Draw `tools` as part of their targets (hidden), or show them for editing. */
export function setOperandsShown(modelId: string, tools: Iterable<number>, shown: boolean): void {
  const ids = renderIds(modelId, tools);
  if (!ids.length) return;
  const s = useViewerStore.getState();
  if (shown) s.showEntities(ids);
  else s.hideEntities(ids);
}

/** The tools of `targets`' live combinations. */
export function operandsOf(modelId: string, targets: readonly number[]): number[] {
  const set = new Set(targets);
  return combinationsOf(modelId, set).filter((c) => set.has(c.target)).map((c) => c.tool);
}

/** Write again the bodies of the targets whose tools or selves `ids` changed; one step with the edit. */
function follow(modelId: string, ids: readonly number[]): void {
  const touched = new Set(ids);
  const ties = combinationsOf(modelId, touched);
  const targets = [...new Set(ties.map((c) => c.target))];
  if (!targets.length) return;
  const s = useViewerStore.getState();
  const top = s.undoStacks.get(modelId)?.at(-1);
  const batchId = top ? s.mutationBatchTags.get(top.id) : undefined;
  rebaking = true;
  try {
    recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      for (const target of targets) rebakeCombinationInStore(ds, editor, target);
    }, batchId);
    // The targets the request does not already re-mesh.
    const missing = targets.filter((t) => !touched.has(t));
    if (missing.length) void requestRemesh(useViewerStore.getState, modelId, missing, 'shape');
  } catch {
    // A tool that can no longer be carried leaves the last body: the edit itself stands.
  } finally {
    rebaking = false;
  }
}

/** After undo or redo: tools drawn as the restored ties say. */
function reconcile(modelId: string, ids: readonly number[]): void {
  const tools = new Set(combinationsOf(modelId).map((c) => c.tool));
  const hidden = useViewerStore.getState().hiddenEntities;
  const ofIds = renderIds(modelId, ids);
  const show = ids.filter((id, i) => !tools.has(id) && hidden.has(ofIds[i]));
  const hide = ids.filter((id, i) => tools.has(id) && !hidden.has(ofIds[i]));
  setOperandsShown(modelId, show, true);
  setOperandsShown(modelId, hide, false);
}

observeRemeshRequests((_get, modelId, ids) => {
  if (rebaking || !ids.length) return;
  if (remeshIsReplay()) reconcile(modelId, ids);
  else follow(modelId, ids);
});

/** Models whose tools were hidden once loaded. */
const loaded = new Set<string>();
useViewerStore.subscribe((s) => {
  for (const [id, model] of s.models) {
    if (loaded.has(id) || model.loadState !== 'complete') continue;
    loaded.add(id);
    queueMicrotask(() => setOperandsShown(id, combinationsOf(id).map((c) => c.tool), false));
  }
});
