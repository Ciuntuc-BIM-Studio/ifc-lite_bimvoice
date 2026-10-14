/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The live push / pull preview (N3, behind `?perf.nativeRemesh=1`): the size
 * write the commit makes (`setElementSizeInStore`) runs on a draft of the
 * model, and what it reshaped is drawn with its real geometry (openings,
 * layers) instead of the plain prism.
 *
 * A new thickness for a wall or slab with material layers is left to the
 * prism: the commit also rewrites the element's layer set
 * (`element-size-commit.ts`), which the draft does not.
 */

import { setElementSizeInStore } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { layerSetOf } from '@/lib/commands/modeling/authored-kinds';
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
  if ((patch.kind === 'wall' || patch.kind === 'slab') && patch.thickness !== undefined) {
    const layers = layerSetOf({ dataStore, view: s.mutationViews.get(modelId) }, expressId)?.layers;
    const total = layers?.reduce((sum, l) => sum + l.thickness, 0);
    if (total !== undefined && Math.abs(total - patch.thickness) > 1e-6) return;
  }
  schedulePreview(commandId, () => previewEditNatively(modelId, (ctx) => {
    const result = setElementSizeInStore(ctx, expressId, patch);
    return result.ok ? result.remesh : [];
  }));
}
