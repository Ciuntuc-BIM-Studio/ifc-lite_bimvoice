/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Convert to native" in the app (N7): plan what an imported model can
 * become (`planNativeConversion`), then convert it in one undo step — its
 * untyped doors and windows take Lapin joinery types of their size, added to
 * the project's joinery catalogue so the configurator edits them — and
 * re-mesh what changed.
 */

import { convertToNativeInStore, planNativeConversion, type NativeConversionPlan } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { importJoinery } from '@/joinery/catalog';
import { invalidateJoineryReads } from '@/joinery/element-spec';
import { ensureEditMode } from '@/project/edit-mode';

/** What converting `modelId` would do, or null when the model cannot be edited. */
export function planModelConversion(modelId: string): NativeConversionPlan | null {
  const target = modelEditTarget(useViewerStore.getState(), modelId);
  return target ? planNativeConversion(target.dataStore, target.view) : null;
}

export interface ModelConversionOutcome {
  converted: number;
  types: number;
  refused: string[];
}

/** Convert `modelId` as `plan` says (one undo step). */
export function convertModelToNative(modelId: string, plan: NativeConversionPlan): ModelConversionOutcome {
  ensureEditMode();
  if (plan.joinery.length === 0) return { converted: 0, types: 0, refused: [] };
  try {
    importJoinery(plan.joinery.map((g) => g.spec));
    const result = recordModellingCommit(useViewerStore, modelId, (editor, ds) => convertToNativeInStore(ds, editor, plan));
    invalidateJoineryReads(modelId);
    if (result.remesh.length) void requestRemesh(useViewerStore.getState, modelId, result.remesh, 'shape');
    return { converted: result.converted, types: plan.joinery.length, refused: result.refused.map((r) => `#${r.id}: ${r.reason}`) };
  } catch (error) {
    return { converted: 0, types: 0, refused: [error instanceof Error ? error.message : String(error)] };
  }
}
