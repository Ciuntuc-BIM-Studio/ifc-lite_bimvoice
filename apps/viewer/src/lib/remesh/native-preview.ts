/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Live preview of an edit, drawn with the elements' real geometry while a
 * gesture runs (N3, behind `?perf.nativeRemesh=1`): the edit is applied to a
 * throwaway draft of the model (`runAtomic`, then abandoned, so nothing is
 * written and nothing enters undo), the elements it changes are planned on
 * that draft and meshed from their parameters by the native mesher, and the
 * meshes are taken to the render frame like a remesh's. The command shows
 * them as its ghost; release commits the real edit as before.
 *
 * Elements the native path cannot rebuild exactly are left out of the
 * preview (the command keeps its simple ghost for them).
 */

import type { MeshData } from '@ifc-lite/geometry';
import { planNativeRemesh, type NativeRemeshPlan } from '@ifc-lite/create';
import type { StoreEditor, MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { modelEditTarget } from '@/store/slices/mutation-modelling-records';
import { commandGhostId } from '@/lib/commands/modeling/ghost';
import { loadRtcFrame, toRenderFrame } from './render-frame';
import { drawnMeshes, nativeRemeshEnabled, planColors } from './native-remesh';
import { remeshWorkerFor } from './remesh-service';

/** What an edit sees: the model's store and the draft it writes to. */
export interface PreviewEditContext {
  dataStore: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
}

export interface NativePreview {
  /** Ghost meshes, render frame, tagged with command ghost ids. */
  meshes: MeshData[];
  /** The real elements (global ids) the preview stands in for. */
  replaces: number[];
}

const ABANDON = Symbol('native-preview');

/**
 * Preview `edit` (which returns the express ids it changed) on a draft of
 * `modelId`; null when the flag is off, the edit refuses, or nothing it
 * changes can be meshed natively.
 */
export async function previewEditNatively(modelId: string, edit: (ctx: PreviewEditContext) => readonly number[]): Promise<NativePreview | null> {
  if (!nativeRemeshEnabled()) return null;
  const state = useViewerStore.getState();
  const model = state.models.get(modelId);
  const target = modelEditTarget(state, modelId);
  const frame = model ? loadRtcFrame(model) : null;
  if (!model || !target || !frame) return null;
  let plan: NativeRemeshPlan | null = null;
  try {
    target.editor.runAtomic((draft) => {
      const view = draft.getMutationView();
      const changed = edit({ dataStore: target.dataStore, view, editor: draft });
      plan = planNativeRemesh(target.dataStore, view, changed);
      throw ABANDON;
    });
  } catch (error) {
    if (error !== ABANDON) return null;
  }
  const planned = plan as NativeRemeshPlan | null;
  if (!planned || planned.expressIds.length === 0) return null;
  const toGlobal = (id: number) => toGlobalIdFromModels(state.models, modelId, id);
  const { colors, materialColors } = planColors(drawnMeshes(model), planned, toGlobal);
  const pending = remeshWorkerFor(state, model);
  const worker = pending instanceof Promise ? await pending : pending;
  if (!worker.remeshNative) return null;
  const result = await worker.remeshNative({
    buffer: planned.buffer, expressIds: Uint32Array.from(planned.expressIds), ifcTypes: planned.ifcTypes,
    colors, layers: planned.layers, materialIds: Uint32Array.from(planned.materialIds), materialColors, frame,
  });
  const current = useViewerStore.getState();
  const framed = await toRenderFrame(result.meshes, model, target.dataStore, current.georefMutations.get(modelId));
  if (!framed.ok) return null;
  // Ghost ids: one per previewed element, never a real model's id.
  const ghostOf = new Map(planned.expressIds.map((id, k) => [toGlobal(id), commandGhostId(current, k)]));
  for (const mesh of framed.meshes) mesh.expressId = ghostOf.get(mesh.expressId) ?? mesh.expressId;
  return { meshes: framed.meshes, replaces: [...ghostOf.keys()] };
}

/** Real elements hidden while their preview stands in for them; shown again by `endPreview`. */
let hiddenForPreview = new Set<number>();

/** Hide what `preview` replaces (only what was visible), keeping track to show it again. */
export function standInFor(preview: NativePreview): void {
  const s = useViewerStore.getState();
  const hide = preview.replaces.filter((id) => !hiddenForPreview.has(id) && !s.hiddenEntities.has(id));
  if (hide.length === 0) return;
  for (const id of hide) hiddenForPreview.add(id);
  s.hideEntities(hide);
}

/** Show again every element a preview hid. */
export function endPreview(): void {
  if (hiddenForPreview.size === 0) return;
  const ids = [...hiddenForPreview];
  hiddenForPreview = new Set();
  useViewerStore.getState().showEntities(ids);
}

/**
 * After a commit: show the hidden elements again once the model's geometry
 * has been replaced (the remesh landed), so the old shape never flashes; at
 * the latest after `timeoutMs`.
 */
export function endPreviewAfterRemesh(modelId: string, timeoutMs = 1500): void {
  if (hiddenForPreview.size === 0) return;
  const before = useViewerStore.getState().models.get(modelId)?.geometryResult;
  let done = false;
  const finish = () => { if (done) return; done = true; unsubscribe(); clearTimeout(timer); endPreview(); };
  const unsubscribe = useViewerStore.subscribe((s) => { if (s.models.get(modelId)?.geometryResult !== before) finish(); });
  const timer = setTimeout(finish, timeoutMs);
}
