/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Writing a solid built from drafted shapes — a roof, a sweep, a revolve —
 * as an IfcFacetedBrep element of a loaded model, and rebuilding it in place
 * (same element and GlobalId) when those shapes change. The shapes are
 * turned into faces in the target storey's local frame by `build`.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { addFacetedElementToStore, replaceFacetedGeometryInStore, resolveSpatialAnchor } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { ensureStoreyPlacement } from '@/store/slices/storeyPlacement';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { registerAuthoredElement } from '@/utils/spatialHierarchy';
import type { Vec3 } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { findElementByGlobalId, prepare, type ContourElementResult } from './contour-element';
import type { ProjectView } from './types';

type V3 = [number, number, number];

export interface FacetedGeometry {
  faces: V3[][];
  location: V3;
}

/** Faces from shapes, given the world → storey-local mapping of the target storey. */
export type FacetedBuild = (toLocal: (p: Vec3) => Vec3) => FacetedGeometry;

export interface FacetedSpec {
  ifcClass: string;
  predefinedType?: string;
  name?: string;
  /** Pset_IfcLiteAuthoring entries describing how it was made. */
  authoring: { name: string; value: string | number; type: 'LABEL' | 'REAL' }[];
}

/** `refLoop` (drawing coordinates) picks the model and storey, as a contour does. */
export function createFacetedElement(
  view: ProjectView, plane: SectionPlaneConfig, refLoop: Pt[], build: FacetedBuild, spec: FacetedSpec, sourceId: string,
): ContourElementResult {
  const ready = prepare(view, plane, [refLoop]);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const geometry = build(ready.toLocal);
    const made = recordModellingCommit(useViewerStore, ready.modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      const result = addFacetedElementToStore(editor, anchor, {
        IfcClass: spec.ifcClass, PredefinedType: spec.predefinedType, Name: spec.name, Faces: geometry.faces, Location: geometry.location,
      });
      editor.addPropertySet(result.elementId, 'Pset_IfcLiteAuthoring', [
        { name: 'SourceContour', value: sourceId, type: 'LABEL' },
        { name: 'SourceView', value: view.name, type: 'LABEL' },
        ...spec.authoring,
      ]);
      return result;
    });
    const hierarchy = ready.edit.dataStore.spatialHierarchy;
    if (hierarchy) registerAuthoredElement(hierarchy, ready.storeyId, made.elementId, made.ifcClass.toUpperCase(), spec.name ?? made.ifcClass.replace(/^Ifc/, ''));
    void requestRemesh(useViewerStore.getState, ready.modelId, [made.elementId], 'created');
    return { ok: true, modelId: ready.modelId, elementId: made.elementId, globalId: made.globalId, ifcClass: made.ifcClass };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function updateFacetedElement(
  view: ProjectView, plane: SectionPlaneConfig, refLoop: Pt[], build: FacetedBuild, ifcClass: string, modelId: string, globalId: string,
): ContourElementResult {
  const elementId = findElementByGlobalId(modelId, globalId);
  if (elementId === null) return { ok: false, error: 'The linked element is no longer in the model.' };
  const ready = prepare(view, plane, [refLoop]);
  if (!ready.ok) return { ok: false, error: ready.error };
  try {
    const geometry = build(ready.toLocal);
    recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      ensureStoreyPlacement(ds, editor, ready.storeyId);
      const anchor = resolveSpatialAnchor(ds, ready.storeyId, editor.getMutationView());
      replaceFacetedGeometryInStore(editor, anchor, elementId, { IfcClass: ifcClass, Faces: geometry.faces, Location: geometry.location });
    });
    void requestRemesh(useViewerStore.getState, modelId, [elementId], 'shape');
    return { ok: true, modelId, elementId, globalId, ifcClass };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
