/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Timber trusses in the loaded models (`@ifc-lite/create`'s truss-store):
 * the truss the TRUSS tool draws next (`trussDefaults`, set on the command
 * line or in the configurator), a truss drawn from two points on a view (its
 * bottom chord, the span), read back from any of its bars and rebuilt from a
 * changed spec in place — one undo step each.
 *
 * On a plan both points are at `base` above the level (the wall plate); on
 * a section or an elevation the bottom chord runs at the first point's height.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import {
  addTrussToStore, defaultTimberTruss, readPlacedTruss, regenerateTrussInStore, resolveSpatialAnchor, trussOf, type PlacedTrussSpec, type TimberTrussSpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { stashAndPruneEntityMesh } from '@/store/slices/mutation-mesh-stash';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { prepareTarget } from './contour-element';
import { storeyOfElement } from './effective-storey';
import { ensureEditMode } from './edit-mode';
import type { ProjectView } from './types';

type Vec3 = [number, number, number];

/** What TRUSS draws next: the truss without its span (the two points give it), and on plans its height above the level. */
export const trussDefaults: TimberTrussSpec & { base: number; name: string } = { ...defaultTimberTruss(), base: 2.6, name: 'Truss' };

export type TrussOutcome = { ok: true; trussId: number; modelId: string } | { ok: false; error: string };

/** Draw a truss with its bottom chord from `a` to `b` on `view`. One undo step. */
export function createTruss(view: ProjectView, plane: SectionPlaneConfig, a: Pt, b: Pt, defaults = trussDefaults): TrussOutcome {
  const wa = drawingToWorld(plane, a), wb = drawingToWorld(plane, b);
  const ready = prepareTarget(view, Math.min(wa.y, wb.y));
  if (!ready.ok) return { ok: false, error: ready.error };
  const la = ready.toLocal(wa), lb = ready.toLocal(wb);
  const z = view.kind === 'plan' ? la.z + defaults.base : la.z;
  const start: Vec3 = [la.x, la.y, z], end: Vec3 = [lb.x, lb.y, z];
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.5) return { ok: false, error: 'The span must be at least 0.5 m (two points apart in plan).' };
  const { base: _base, ...truss } = defaults;
  void _base;
  try {
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      return addTrussToStore(ds, editor, resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView()), { ...truss, start, end });
    });
    const hierarchy = ready.edit.dataStore.spatialHierarchy;
    if (hierarchy) {
      registerAuthoredElement(hierarchy, ready.storeyId, made.trussId, 'IFCELEMENTASSEMBLY', truss.name);
      for (const id of made.parts) if (!hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, ready.storeyId);
    }
    void requestRemesh(useViewerStore.getState, ready.modelId, made.parts, 'created');
    return { ok: true, trussId: made.trussId, modelId: ready.modelId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface TrussRef {
  modelId: string;
  trussId: number;
  spec: PlacedTrussSpec;
}

/** The truss of an element (the assembly or any of its bars), by renderer id. */
export function trussOfRenderId(renderId: number): TrussRef | null {
  const s = useViewerStore.getState();
  const ref = s.resolveGlobalIdFromModels(renderId);
  const target = ref ? modelEditTarget(s, ref.modelId) : null;
  if (!ref || !target) return null;
  const trussId = trussOf(target.dataStore, ref.expressId, target.view);
  const spec = trussId === null ? null : readPlacedTruss(target.dataStore, target.editor, trussId);
  return trussId !== null && spec ? { modelId: ref.modelId, trussId, spec } : null;
}

/** The selected element's truss, if it belongs to one. */
export function selectedTruss(): TrussRef | null {
  const id = useViewerStore.getState().selectedEntityId;
  return id === null ? null : trussOfRenderId(id);
}

/** Rebuild a truss from a changed spec, where it stands. One undo step. */
export function applyTruss(ref: Pick<TrussRef, 'modelId' | 'trussId'>, spec: PlacedTrussSpec): { ok: true } | { ok: false; error: string } {
  ensureEditMode();
  const storeyId = storeyOfElement(ref.modelId, ref.trussId);
  if (storeyId === null) return { ok: false, error: 'The truss is not on a storey.' };
  try {
    const result = recordModellingCommit(useViewerStore, ref.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, storeyId);
      return regenerateTrussInStore(ds, editor, resolveSpatialAnchor(ds, storeyId, editor.getMutationView()), ref.trussId, spec);
    });
    // Bars the new layout no longer has leave the 3D view and the tree.
    for (const id of result.removed) stashAndPruneEntityMesh(useViewerStore.getState, useViewerStore.setState, ref.modelId, id);
    const hierarchy = useViewerStore.getState().models.get(ref.modelId)?.ifcDataStore?.spatialHierarchy;
    if (hierarchy) {
      for (const id of result.removed) hierarchy.elementToStorey.delete(id);
      for (const id of result.parts) if (!hierarchy.elementToStorey.has(id)) hierarchy.elementToStorey.set(id, storeyId);
    }
    void requestRemesh(useViewerStore.getState, ref.modelId, result.parts, 'created');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
