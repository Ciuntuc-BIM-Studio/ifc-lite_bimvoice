/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's location in the viewer (`project-location.ts`): read from
 * the models, written to every model the user may edit as their
 * IfcProjectedCRS and IfcMapConversion (the georeferencing edits the IFC
 * export writes and the project file keeps, one undo step per model), and
 * the dialog's state, kept while a point is picked in a plan.
 */

import { create } from 'zustand';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { fromStoreyLocal } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { canMutate } from '@/store/mutation-permission';
import { getEffectiveGeoreference } from '@/lib/geo/effective-georef';
import { buildStoreyWorkplane, isWorkplane } from '@/lib/commands/modeling/workplane';
import { storeyAuthoringFrame } from '@/lib/authoring/storey-authoring-frame';
import { effectiveStoreyElevation } from '@/lib/commands/modeling/effective-storeys';
import { drawingToWorld } from '@/drafting/frame';
import type { Pt } from '@/drafting/types';
import { resolveTarget } from './contour-element';
import { isDrawingTabActive } from './document-tabs';
import { startDraftCommand } from '@/drafting/session';
import { ensureEditMode } from './edit-mode';
import type { ProjectView } from './types';
import type { LocationSolution, MapConversionFields, Vec3 } from './project-location';
import { crsFromStored, type LocationCrs } from './project-location-crs';

/** The dialog's form, kept while a point is picked in a plan. Numbers as typed. */
export interface LocationDraft {
  crs: LocationCrs;
  base: { local: string[]; map: string[] };
  rotation: 'angle' | 'point';
  angle: string;
  second: { local: string[]; map: string[] };
}

/** The dialog: closed or open, the form, and which point a plan pick is for. */
export const useProjectLocationDialog = create<{ open: boolean; draft: LocationDraft | null; picking: 'base' | 'second' | null }>()(
  () => ({ open: false, draft: null, picking: null }),
);

export function openProjectLocation(): void {
  useProjectLocationDialog.setState({ open: true, picking: null });
}

export function closeProjectLocation(): void {
  useProjectLocationDialog.setState({ open: false, draft: null, picking: null });
}

/** Leave the dialog to pick a point in the plan in front (`LOCATION`); false when no plan is. */
export function pickLocationPoint(which: 'base' | 'second', draft: LocationDraft): boolean {
  if (!isDrawingTabActive()) return false;
  useProjectLocationDialog.setState({ open: false, draft, picking: which });
  startDraftCommand('location');
  return true;
}

/** The plan pick's point (project coordinates): back to the dialog with it filled in; null keeps the form as it was. */
export function finishLocationPick(point: Vec3 | null): void {
  const { draft, picking } = useProjectLocationDialog.getState();
  if (draft && picking && point) {
    const local = point.map((v) => String(Math.round(v * 1000) / 1000));
    useProjectLocationDialog.setState({ open: true, picking: null, draft: { ...draft, [picking]: { ...draft[picking], local: picking === 'base' ? local : local.slice(0, 2) } } });
  } else {
    useProjectLocationDialog.setState({ open: true, picking: null });
  }
}

/** The models the location is written to: every loaded model with IFC data the user may edit (Apply turns Edit mode on). */
export function locationModels(): string[] {
  const s = useViewerStore.getState();
  const editing = { ...s, editEnabled: s.editEnabled || s.canCollabEdit() };
  return [...s.models.values()].filter((m) => m.ifcDataStore && canMutate(editing, m.id)).map((m) => m.id);
}

/** The location the models carry now (the first that has one), or null. */
export function readProjectLocation(): { crs: LocationCrs; conversion: MapConversionFields | null } | null {
  const s = useViewerStore.getState();
  for (const id of locationModels()) {
    const model = s.models.get(id)!;
    const georef = getEffectiveGeoreference(model.ifcDataStore, model.geometryResult?.coordinateInfo, s.georefMutations.get(id));
    if (!georef?.projectedCRS?.name && !georef?.mapConversion) continue;
    const crs = georef.projectedCRS;
    return {
      crs: crsFromStored(crs?.name, crs?.verticalDatum),
      conversion: georef.mapConversion ?? null,
    };
  }
  return null;
}

/** Write the location to every model it applies to. The number of models written. */
export function applyProjectLocation(crs: LocationCrs, solution: LocationSolution): number {
  if (!ensureEditMode()) return 0;
  const s = useViewerStore.getState();
  const ids = locationModels();
  for (const id of ids) {
    const model = s.models.get(id)!;
    const georef = getEffectiveGeoreference(model.ifcDataStore, model.geometryResult?.coordinateInfo, s.georefMutations.get(id));
    const was = (georef?.projectedCRS ?? {}) as Record<string, unknown>;
    const wasConversion = (georef?.mapConversion ?? {}) as Record<string, unknown>;
    const field = (old: Record<string, unknown>, name: string, value: string | number) => ({ field: name, value, oldValue: old[name] as string | number | undefined });
    s.setGeorefFields(id, 'projectedCRS', [
      field(was, 'name', crs.name),
      ...(['description', 'geodeticDatum', 'verticalDatum', 'mapProjection', 'mapZone'] as const).flatMap((k) => (crs[k] ? [field(was, k, crs[k]!)] : [])),
      field(was, 'mapUnit', 'METRE'),
    ]);
    s.setGeorefFields(id, 'mapConversion', [
      field(wasConversion, 'eastings', solution.eastings),
      field(wasConversion, 'northings', solution.northings),
      field(wasConversion, 'orthogonalHeight', solution.orthogonalHeight),
      field(wasConversion, 'xAxisAbscissa', solution.xAxisAbscissa),
      field(wasConversion, 'xAxisOrdinate', solution.xAxisOrdinate),
      field(wasConversion, 'scale', 1),
    ]);
  }
  return ids.length;
}

/** A point of a plan view's drawing in the project's coordinates (metres, Z up), or null off a plan with a model. */
export function planPointToProject(view: ProjectView, plane: SectionPlaneConfig, p: Pt): Vec3 | null {
  if (view.kind !== 'plan') return null;
  const target = resolveTarget(view, view.level.elevation);
  if (!target) return null;
  const s = useViewerStore.getState();
  const model = s.models.get(target.modelId);
  const workplane = buildStoreyWorkplane(s, target.modelId, target.storeyId, 0);
  if (!model?.ifcDataStore || !isWorkplane(workplane)) return null;
  const w = drawingToWorld(plane, p);
  const local = workplane.renderToLocal([w.x, w.y, w.z]);
  const { plan } = storeyAuthoringFrame(model.ifcDataStore, target.storeyId, undefined);
  const [x, y] = fromStoreyLocal(plan, [local[0], local[1]]);
  // The level itself: the floor of the plan's storey (the cut height is where the view looks, not the point).
  return [x, y, effectiveStoreyElevation(model.ifcDataStore, s.mutationViews.get(target.modelId), target.storeyId)];
}
