/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Wall join style: automatic and manual.
 *
 * Automatic — the style `wall.place` gives the corners it joins
 * (`joinPlacedWallIn`), a remembered preference: butt (one wall runs
 * through, the other stops at its face) or mitre (both cut on the diagonal).
 *
 * Manual — restyle the corners of the selected walls: mitre them, butt them,
 * or swap which wall runs through a butt corner. Each is one undo step per
 * model; the style is written on the `IfcRelConnectsPathElements`
 * (`Description`), so moving a wall later keeps it.
 */

import { joinWallsInStore, readWallJoinRels, resolveWallJoinAnchor } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { mutationDenial } from '@/store/mutation-permission';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { requestRemesh } from '@/lib/remesh/remesh-service';

export { defaultWallJoinStyle, setDefaultWallJoinStyle, useWallJoinPrefs, type WallJoinStyle } from './wall-join-prefs';
import type { WallJoinStyle } from './wall-join-prefs';

export type WallJoinChange = { style: WallJoinStyle } | { swap: true };

export type WallJoinChangeOutcome = { ok: true; corners: number } | { ok: false; reason: string };

/** The selected entities, per model (model-local ids). */
function selectionByModel(): Map<string, Set<number>> {
  const s = useViewerStore.getState();
  const ids = new Set(s.selectedEntityIds);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const byModel = new Map<string, Set<number>>();
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (!ref) continue;
    const set = byModel.get(ref.modelId) ?? new Set<number>();
    set.add(ref.expressId);
    byModel.set(ref.modelId, set);
  }
  return byModel;
}

/**
 * Restyle the end-to-end joins (corners and collinear joins, not T's) of
 * the selected walls. `corners: 0` when the selection has none.
 */
export function changeSelectedWallJoins(change: WallJoinChange): WallJoinChangeOutcome {
  let corners = 0;
  for (const [modelId, walls] of selectionByModel()) {
    const state = useViewerStore.getState();
    const target = modelEditTarget(state, modelId);
    if (!target) continue;
    const rels = readWallJoinRels(target.dataStore, target.view, walls)
      .filter((rel) => rel.relatingConnection !== 'ATPATH' && rel.relatedConnection !== 'ATPATH');
    if (rels.length === 0) continue;
    const denial = mutationDenial(state, modelId);
    if (denial) return { ok: false, reason: denial };
    const touched = new Set<number>();
    try {
      recordModellingCommit(useViewerStore, modelId, (editor, dataStore) => {
        const anchor = resolveWallJoinAnchor(dataStore, editor.getMutationView());
        for (const rel of rels) {
          // `a` is the relating wall: swapping makes the related one (`b`) run through.
          const options = 'swap' in change ? { priority: 'b' as const } : { style: change.style, priority: 'a' as const };
          joinWallsInStore(editor, dataStore, anchor, rel.relatingId, rel.relatedId, options);
          touched.add(rel.relatingId);
          touched.add(rel.relatedId);
        }
      });
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    corners += rels.length;
    void requestRemesh(useViewerStore.getState, modelId, touched, 'shape');
  }
  return { ok: true, corners };
}
