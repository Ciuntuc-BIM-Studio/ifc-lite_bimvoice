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
import { meshInRender, toRenderFor } from '@/lib/commands/modeling/commands/element-transform-shared';
import type { Vec3 } from '@/lib/commands/modeling/types';
import { getCommandRuntime, subscribeCommandRuntime, updateCommandGesture } from '@/lib/commands/modeling/runtime';
import { loadRtcFrame, toRenderFrame } from './render-frame';
import { colourFromStyles, drawnMeshes, nativeRemeshEnabled, planColors } from './native-remesh';
import { readyStyleWire, stylesWithOverlay } from './style-wires';
import { remeshWorkerFor } from './remesh-service';

/** What an edit sees: the model's store and the draft it writes to. */
export interface PreviewEditContext {
  dataStore: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
}

/**
 * Real elements carried along unchanged: drawn as they are now, through
 * `apply` (render space). One the edit also changed and the native path
 * rebuilds is drawn rebuilt instead.
 */
export interface CarriedElements {
  /** Express ids in the model. */
  ids: readonly number[];
  apply: (p: Vec3) => Vec3;
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
export async function previewEditNatively(
  modelId: string,
  edit: (ctx: PreviewEditContext) => readonly number[],
  carried?: CarriedElements,
): Promise<NativePreview | null> {
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
  const drawn = drawnMeshes(model);
  const { colors, materialColors } = planColors(drawn, planned, toGlobal);
  // A part not drawn yet (a new joinery type's box) takes its style, as the commit's re-mesh will.
  const wire = readyStyleWire(target.dataStore);
  if (wire) colourFromStyles(planned, colors, stylesWithOverlay(wire, target.dataStore, target.view, new Set(planned.expressIds)));
  const pending = remeshWorkerFor(state, model);
  const worker = pending instanceof Promise ? await pending : pending;
  if (!worker.remeshNative) return null;
  const result = await worker.remeshNative({
    buffer: planned.buffer, expressIds: Uint32Array.from(planned.expressIds), ifcTypes: planned.ifcTypes,
    colors, itemIds: Uint32Array.from(planned.itemIds), frames: planned.frames, layers: planned.layers, materialIds: Uint32Array.from(planned.materialIds), materialColors, frame,
  });
  const current = useViewerStore.getState();
  const framed = await toRenderFrame(result.meshes, model, target.dataStore, current.georefMutations.get(modelId));
  if (!framed.ok) return null;
  // Ghost ids: one per previewed element, never a real model's id.
  const ghostOf = new Map(planned.expressIds.map((id, k) => [toGlobal(id), commandGhostId(current, k)]));
  // The ghost channel draws in render space: each mesh's origin and the model's placement applied.
  const toRender = toRenderFor(current, modelId);
  const same = (p: Vec3) => p;
  const meshes = framed.meshes.map((mesh) => meshInRender(toRender, same, mesh, ghostOf.get(mesh.expressId) ?? mesh.expressId, mesh.color));
  for (const id of carried?.ids ?? []) {
    const global = toGlobal(id);
    if (ghostOf.has(global)) continue;
    const ghost = commandGhostId(current, ghostOf.size);
    ghostOf.set(global, ghost);
    for (const mesh of drawn.get(global) ?? []) meshes.push(meshInRender(toRender, carried!.apply, mesh, ghost, mesh.color));
  }
  return { meshes, replaces: [...ghostOf.keys()] };
}

/** A gesture that can show a native preview as its ghost. */
export interface PreviewingGesture {
  readonly preview: MeshData[] | null;
}

/** One native preview at a time; the newest request replaces any waiting one. */
let previewBusy = false;
let previewWaiting: (() => Promise<void>) | null = null;

/**
 * Build a preview with `build` and, if the command `commandId` still runs
 * when it is ready, stand it in for the real elements and put it on the
 * gesture. Requests made while one builds collapse into the newest.
 */
export function schedulePreview(commandId: string, build: () => Promise<NativePreview | null>): void {
  const run = async () => {
    previewBusy = true;
    try {
      const preview = await build();
      if (!preview || getCommandRuntime().command?.id !== commandId) return;
      standInFor(preview);
      updateCommandGesture((current) => ({ ...(current as PreviewingGesture), preview: preview.meshes }));
    } catch {
      // A preview that cannot be built leaves the command's own ghost.
    } finally {
      previewBusy = false;
      const waiting = previewWaiting;
      previewWaiting = null;
      if (waiting) void waiting();
    }
  };
  if (previewBusy) previewWaiting = run;
  else void run();
}

/** Real elements hidden while their preview stands in for them; shown again by `endPreview`. */
let hiddenForPreview = new Set<number>();
/** Ends the preview when the command drops it (a reset gesture, the command ending). */
let unwatch: (() => void) | null = null;

/** Hide what `preview` replaces (only what was visible), keeping track to show it again. */
export function standInFor(preview: NativePreview): void {
  const s = useViewerStore.getState();
  const hide = preview.replaces.filter((id) => !hiddenForPreview.has(id) && !s.hiddenEntities.has(id));
  if (hide.length === 0) return;
  for (const id of hide) hiddenForPreview.add(id);
  s.hideEntities(hide);
  unwatch ??= subscribeCommandRuntime(() => {
    const runtime = getCommandRuntime();
    if (!runtime.command || !(runtime.gesture as PreviewingGesture | null)?.preview) endPreview();
  });
}

function stopWatching(): void {
  unwatch?.();
  unwatch = null;
}

/** Show again every element a preview hid. */
export function endPreview(): void {
  stopWatching();
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
  stopWatching();
  if (hiddenForPreview.size === 0) return;
  const before = useViewerStore.getState().models.get(modelId)?.geometryResult;
  let done = false;
  const finish = () => { if (done) return; done = true; unsubscribe(); clearTimeout(timer); endPreview(); };
  const unsubscribe = useViewerStore.subscribe((s) => { if (s.models.get(modelId)?.geometryResult !== before) finish(); });
  const timer = setTimeout(finish, timeoutMs);
}
