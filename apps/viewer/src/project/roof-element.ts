/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * From a closed contour on a floor plan to an IfcRoof, and back — the roof
 * counterpart of `contour-element.ts`. The outline is taken into the
 * storey's plan (storey-local metres), the roof surface and solid come from
 * `@ifc-lite/create` (`roofFacets` / `roofSolidFaces`: flat, mono-pitch,
 * gable, hip), written as an IfcFacetedBrep. The roof's eaves sit on the
 * plan's level plus `offset`. Editing the contour (or its roof parameters)
 * rebuilds the same element.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import {
  addFacetedElementToStore, replaceFacetedGeometryInStore, resolveSpatialAnchor, roofFacets, roofSolidFaces, type RoofKind,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { findElementByGlobalId, prepare, type ContourElementResult } from './contour-element';
import type { ProjectView } from './types';

export interface RoofSpec {
  kind: RoofKind;
  /** Pitch, degrees. */
  slope: number;
  /** Vertical thickness, metres. */
  thickness: number;
  /** Eaves above the plan's level, metres. */
  offset: number;
  /** Eave edge of a mono-pitch roof (contour edge index). */
  eaveEdge?: number;
}

const PREDEFINED: Record<RoofKind, string> = { flat: 'FLAT_ROOF', mono: 'SHED_ROOF', gable: 'GABLE_ROOF', hip: 'HIP_ROOF' };

type Geometry = { faces: [number, number, number][][]; location: [number, number, number] };

function roofGeometry(outline: Pt[], plane: SectionPlaneConfig, toLocal: (p: { x: number; y: number; z: number }) => { x: number; y: number; z: number }, spec: RoofSpec): Geometry {
  const local = outline.map((p) => toLocal(drawingToWorld(plane, p)));
  const facets = roofFacets(local.map((p) => [p.x, p.y]), { kind: spec.kind, slope: (spec.slope * Math.PI) / 180, eaveEdge: spec.eaveEdge });
  return { faces: roofSolidFaces(facets, spec.thickness), location: [0, 0, local[0].z + spec.offset] };
}

function horizontal(view: ProjectView): string | null {
  return view.kind === 'plan' ? null : 'Roofs are drawn on a floor plan.';
}

export function createRoofElement(view: ProjectView, plane: SectionPlaneConfig, outline: Pt[], spec: RoofSpec, sourceId: string): ContourElementResult {
  const refusal = horizontal(view);
  if (refusal) return { ok: false, error: refusal };
  const ready = prepare(view, plane, [outline]);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const geometry = roofGeometry(outline, plane, ready.toLocal, spec);
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      const result = addFacetedElementToStore(editor, anchor, { IfcClass: 'IfcRoof', PredefinedType: PREDEFINED[spec.kind], Faces: geometry.faces, Location: geometry.location });
      editor.addPropertySet(result.elementId, 'Pset_IfcLiteAuthoring', [
        { name: 'SourceContour', value: sourceId, type: 'LABEL' },
        { name: 'SourceView', value: view.name, type: 'LABEL' },
        { name: 'RoofKind', value: spec.kind, type: 'LABEL' },
        { name: 'Pitch', value: spec.slope, type: 'REAL' },
      ]);
      return result;
    });
    const hierarchy = ready.edit.dataStore.spatialHierarchy;
    if (hierarchy) registerAuthoredElement(hierarchy, ready.storeyId, made.elementId, 'IFCROOF', 'Roof');
    void requestRemesh(useViewerStore.getState, ready.modelId, [made.elementId], 'created');
    return { ok: true, modelId: ready.modelId, elementId: made.elementId, globalId: made.globalId, ifcClass: made.ifcClass };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function updateRoofElement(view: ProjectView, plane: SectionPlaneConfig, outline: Pt[], spec: RoofSpec, modelId: string, globalId: string): ContourElementResult {
  const elementId = findElementByGlobalId(modelId, globalId);
  if (elementId === null) return { ok: false, error: 'The linked roof is no longer in the model.' };
  const ready = prepare(view, plane, [outline]);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const geometry = roofGeometry(outline, plane, ready.toLocal, spec);
    recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      replaceFacetedGeometryInStore(editor, anchor, elementId, { IfcClass: 'IfcRoof', Faces: geometry.faces, Location: geometry.location });
    });
    void requestRemesh(useViewerStore.getState, modelId, [elementId], 'shape');
    return { ok: true, modelId, elementId, globalId, ifcClass: 'IfcRoof' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A linked contour's roof parameters, or null when it is not a roof. */
export function roofSpecOf(params: Record<string, unknown>): RoofSpec | null {
  const kind = params.roofKind;
  if (kind !== 'flat' && kind !== 'mono' && kind !== 'gable' && kind !== 'hip') return null;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return { kind, slope: num(params.slope, 30), thickness: num(params.thickness, 0.25), offset: num(params.offset, 0), eaveEdge: num(params.eaveEdge, 0) };
}
