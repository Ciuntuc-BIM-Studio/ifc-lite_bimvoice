/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The live push / pull preview (N3, behind `?perf.nativeRemesh=1`): the size
 * write the commit makes (`setElementSizeInStore`) runs on a draft of the
 * model, and what it reshaped is drawn with its real geometry (openings,
 * layers) instead of the plain prism.
 *
 * A new thickness for a wall or slab with material layers gives the element
 * its own layer set, as the commit does (`layerChangeFor`), so the preview is
 * sliced into the layers the commit leaves.
 */

import {
  addMaterialLayerSetToStore, addMaterialLayerSetUsageToStore, assignMaterialInStore,
  readRelatedLists, resolveAuthoringAnchor, setElementSizeInStore,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { layerChangeFor } from '@/lib/element-size-commit';
import { previewEditNatively, schedulePreview } from '@/lib/remesh/native-preview';
import { faceOf, sizeOf, type PushPullGesture } from './push-pull-gesture';

/** Build the reshaped element's real geometry for `g`'s size, for the command `commandId`. */
export function previewPushPull(commandId: string, g: PushPullGesture): void {
  const face = faceOf(g);
  const size = sizeOf(g);
  if (!g.target || !face || size === null || g.size === null) return;
  const { modelId, expressId } = g.target;
  const patch = face.patch(size);
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return;
  const change = layerChangeFor({ dataStore, view: s.mutationViews.get(modelId) }, expressId, patch);
  schedulePreview(commandId, () => previewEditNatively(modelId, (ctx) => {
    const result = setElementSizeInStore(ctx, expressId, patch);
    if (!result.ok) return [];
    if (change && result.remesh.includes(expressId)) {
      // What `bim.store`'s addMaterialLayerSet / addMaterialLayerSetUsage / assignMaterial write.
      const anchor = resolveAuthoringAnchor(ctx.dataStore, ctx.view);
      const setId = addMaterialLayerSetToStore(ctx.editor, anchor, change.set).layerSetId;
      const usage = addMaterialLayerSetUsageToStore(ctx.editor, anchor, change.usage(setId)).usageId;
      assignMaterialInStore(ctx.editor, anchor, usage, [expressId], readRelatedLists(ctx.dataStore, 'IfcRelAssociatesMaterial', ctx.view));
    }
    return result.remesh;
  }));
}
