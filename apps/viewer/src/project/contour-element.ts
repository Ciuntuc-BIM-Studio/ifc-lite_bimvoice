/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * From a closed contour drawn on a view to an IFC element, and back.
 *
 * The contour (outer loop + holes, drawing coordinates) is lifted onto the
 * view's WORK plane — a floor plan's level, a section / elevation's own
 * plane — then into the storey's local frame through the storey workplane,
 * and extruded along the plane normal toward the viewer by `depth`. The
 * element is a real model entity (one undo step), contained in its storey,
 * carrying a `Pset_IfcLiteAuthoring` that names its source contour; the
 * contour carries the element's GlobalId. Editing the contour later
 * rebuilds the element's geometry in place (same expressId and GlobalId).
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { addExtrusionToStore, replaceExtrusionGeometryInStore, resolveSpatialAnchor, type ExtrusionInStoreParams } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { modelEditTarget, recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { mutationDenial } from '@/store/mutation-permission';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld, type Vec3 } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { modelLevels } from './model-levels';
import type { ProjectView } from './types';

export interface ContourElementSpec {
  ifcClass: string;
  predefinedType?: string;
  name?: string;
  /** Extrusion length, metres; negative extrudes away from the viewer. */
  depth: number;
  /** Start offset from the work plane along the extrusion direction, metres. */
  offset?: number;
}

export type ContourElementResult =
  | { ok: true; modelId: string; elementId: number; globalId: string; ifcClass: string }
  | { ok: false; error: string };

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
};
const tuple = (p: Vec3): V => [p.x, p.y, p.z];

/** The direction (world) a view looks FROM: out of the drawing toward the viewer. */
export function towardViewer(plane: SectionPlaneConfig): V {
  const sign = plane.flipped ? -1 : 1;
  if (plane.customPlane) return [plane.customPlane.normal.x * sign, plane.customPlane.normal.y * sign, plane.customPlane.normal.z * sign];
  return plane.axis === 'x' ? [sign, 0, 0] : plane.axis === 'y' ? [0, sign, 0] : [0, 0, sign];
}

/** Which loaded model and storey the contour belongs to. */
function resolveTarget(view: ProjectView, worldMinY: number): { modelId: string; storeyId: number } | null {
  const state = useViewerStore.getState();
  const editable = [...state.models.values()].filter((m) => m.ifcDataStore);
  const ordered = [...editable.filter((m) => m.id === state.activeModelId), ...editable.filter((m) => m.id !== state.activeModelId)];
  for (const model of ordered) {
    const levels = modelLevels(model.id);
    if (levels.length === 0) continue;
    if (view.kind === 'plan') {
      const hit = levels.find((l) => l.globalId && view.level.storeyGlobalIds.includes(l.globalId))
        ?? levels.find((l) => Math.abs(l.elevation - view.level.elevation) < 0.25);
      if (hit) return { modelId: model.id, storeyId: hit.expressId };
      continue;
    }
    // A section / elevation contour sits on the highest storey at or below its lowest point.
    const below = levels.filter((l) => l.elevation <= worldMinY + 0.01).sort((a, b) => b.elevation - a.elevation)[0];
    return { modelId: model.id, storeyId: (below ?? [...levels].sort((a, b) => a.elevation - b.elevation)[0]).expressId };
  }
  return null;
}

/** Build the extrusion parameters of `loops` (outer first) drawn on `plane`, in the storey's local frame. */
function extrusionParams(
  loops: Pt[][], plane: SectionPlaneConfig, toLocal: (p: Vec3) => Vec3, spec: ContourElementSpec,
): Omit<ExtrusionInStoreParams, 'IfcClass'> {
  const lift = (p: Pt): V => tuple(toLocal(drawingToWorld(plane, p)));
  const origin2 = loops[0][0];
  const originW = drawingToWorld(plane, origin2);
  const toward = towardViewer(plane);
  const flip = spec.depth < 0 ? -1 : 1;
  const normalW = { x: toward[0] * flip, y: toward[1] * flip, z: toward[2] * flip };
  const lo = lift(origin2);
  const ex = unit(sub(lift({ x: origin2.x + 1, y: origin2.y }), lo));
  const ez = unit(sub(tuple(toLocal({ x: originW.x + normalW.x, y: originW.y + normalW.y, z: originW.z + normalW.z })), lo));
  const ey = cross(ez, ex);
  const to2d = (p: Pt): [number, number] => {
    const d = sub(lift(p), lo);
    return [dot(d, ex), dot(d, ey)];
  };
  const offset = spec.offset ?? 0;
  return {
    Name: spec.name,
    PredefinedType: spec.predefinedType,
    Outer: loops[0].map(to2d),
    Holes: loops.slice(1).map((l) => l.map(to2d)),
    Depth: Math.abs(spec.depth),
    Location: [lo[0] + ez[0] * offset, lo[1] + ez[1] * offset, lo[2] + ez[2] * offset],
    Axis: ez,
    RefDirection: ex,
  };
}

type Prepared =
  | { ok: false; error: string }
  | { ok: true; modelId: string; storeyId: number; edit: NonNullable<ReturnType<typeof modelEditTarget>>; toLocal: (p: Vec3) => Vec3 };

function prepare(view: ProjectView, plane: SectionPlaneConfig, loops: Pt[][]): Prepared {
  if (loops.length === 0 || loops[0].length < 3) return { ok: false, error: 'The contour must be closed, with at least three points.' };
  const worldMinY = Math.min(...loops[0].map((p) => drawingToWorld(plane, p).y));
  const target = resolveTarget(view, worldMinY);
  if (!target) return { ok: false, error: 'No loaded model has a storey for this view. Load or create a model first.' };
  const state = useViewerStore.getState();
  const denial = mutationDenial(state, target.modelId);
  if (denial) return { ok: false, error: denial };
  const workplane = buildStoreyWorkplane(state, target.modelId, target.storeyId, 0);
  if ('refused' in workplane) return { ok: false, error: workplane.refused };
  const edit = modelEditTarget(state, target.modelId);
  if (!edit) return { ok: false, error: 'The model cannot be edited.' };
  const toLocal = (p: Vec3): Vec3 => {
    const l = workplane.renderToLocal([p.x, p.y, p.z]);
    return { x: l[0], y: l[1], z: l[2] };
  };
  return { ok: true, ...target, edit, toLocal };
}

/** Create the IFC element of a closed contour. One undo step; the 3D view updates. */
export function createContourElement(view: ProjectView, plane: SectionPlaneConfig, loops: Pt[][], spec: ContourElementSpec, sourceId: string): ContourElementResult {
  const ready = prepare(view, plane, loops);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      const result = addExtrusionToStore(editor, anchor, { IfcClass: spec.ifcClass, ...extrusionParams(loops, plane, ready.toLocal, spec) });
      editor.addPropertySet(result.elementId, 'Pset_IfcLiteAuthoring', [
        { name: 'SourceContour', value: sourceId, type: 'LABEL' },
        { name: 'SourceView', value: view.name, type: 'LABEL' },
        { name: 'ExtrusionDepth', value: spec.depth, type: 'REAL' },
      ]);
      return result;
    });
    const hierarchy = ready.edit.dataStore.spatialHierarchy;
    if (hierarchy) registerAuthoredElement(hierarchy, ready.storeyId, made.elementId, made.ifcClass.toUpperCase(), spec.name ?? made.ifcClass);
    void requestRemesh(useViewerStore.getState, ready.modelId, [made.elementId], 'created');
    return { ok: true, modelId: ready.modelId, elementId: made.elementId, globalId: made.globalId, ifcClass: made.ifcClass };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The element a GlobalId names in a model: parsed, or created in this session. */
export function findElementByGlobalId(modelId: string, globalId: string): number | null {
  const state = useViewerStore.getState();
  const ds = state.models.get(modelId)?.ifcDataStore;
  const view = state.mutationViews.get(modelId);
  const created = view?.getNewEntities().find((e) => e.attributes[0] === globalId && !view.isDeleted(e.expressId));
  if (created) return created.expressId;
  const parsed = ds?.entities.getExpressIdByGlobalId(globalId) ?? 0;
  return parsed > 0 && !view?.isDeleted(parsed) ? parsed : null;
}

/** Rebuild a linked element from its edited contour (same element, same GlobalId). */
export function updateContourElement(view: ProjectView, plane: SectionPlaneConfig, loops: Pt[][], spec: ContourElementSpec, modelId: string, globalId: string): ContourElementResult {
  const elementId = findElementByGlobalId(modelId, globalId);
  if (elementId === null) return { ok: false, error: 'The linked element is no longer in the model.' };
  const ready = prepare(view, plane, loops);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      replaceExtrusionGeometryInStore(editor, anchor, elementId, { IfcClass: spec.ifcClass, ...extrusionParams(loops, plane, ready.toLocal, spec) });
    });
    void requestRemesh(useViewerStore.getState, modelId, [elementId], 'shape');
    return { ok: true, modelId, elementId, globalId, ifcClass: spec.ifcClass };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
