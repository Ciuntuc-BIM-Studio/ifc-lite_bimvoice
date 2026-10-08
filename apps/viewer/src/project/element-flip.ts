/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Flip X / Flip Y on the selection (`@ifc-lite/create`'s
 * `flipElementInStore`), from the Design tab, the 3D context menu or a
 * floor plan: one undo step per model. A door or window without a
 * configured type flips its plan symbol (the project file keeps it); a
 * roof system's part is left alone (its regeneration would undo it).
 */

import { flipElementInStore, type FlipAxis } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { invalidateJoineryReads } from '@/joinery/element-spec';
import { renderIdGlobalId } from './element-guid';
import { toggleSymbolFlips } from './project-store';
import { roofSystemOfRenderId } from './roof-system-element';

export interface FlipReport {
  flipped: number;
  /** Plan symbols flipped (doors / windows without a type). */
  symbols: number;
  refused: string[];
}

/** Flip the given renderer ids (default: the selection) along their own `axis`. */
export function flipElements(axis: FlipAxis, renderIds?: readonly number[]): FlipReport {
  const s = useViewerStore.getState();
  const ids = new Set<number>(renderIds ?? s.selectedEntityIds ?? []);
  if (!renderIds && s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const report: FlipReport = { flipped: 0, symbols: 0, refused: [] };
  const byModel = new Map<string, { renderId: number; expressId: number }[]>();
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (!ref) continue;
    if (roofSystemOfRenderId(id)) {
      report.refused.push('A roof system part changes with its roof: edit it in the roof configurator.');
      continue;
    }
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), { renderId: id, expressId: ref.expressId }]);
  }
  const symbolOnly: string[] = [];
  for (const [modelId, elements] of byModel) {
    const remesh = new Set<number>();
    try {
      recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
        for (const e of elements) {
          const outcome = editor.runAtomic((draft) => flipElementInStore(ds, draft, e.expressId, axis));
          if (outcome.ok) {
            outcome.remesh.forEach((id) => remesh.add(id));
            report.flipped++;
          } else if (outcome.reason === 'untyped-joinery') {
            const guid = renderIdGlobalId(e.renderId);
            if (guid) symbolOnly.push(guid);
          } else report.refused.push(outcome.reason);
        }
      });
    } catch (err) {
      report.refused.push(err instanceof Error ? err.message : String(err));
      continue;
    }
    invalidateJoineryReads(modelId);
    if (remesh.size) void requestRemesh(useViewerStore.getState, modelId, [...remesh], 'shape');
  }
  if (symbolOnly.length) {
    toggleSymbolFlips(symbolOnly, axis === 'x' ? 1 : 2);
    report.symbols = symbolOnly.length;
  }
  return report;
}
