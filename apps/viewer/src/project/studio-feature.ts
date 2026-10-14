/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A Studio solid's history, FreeCAD-style: the steps it was built from stay
 * live and editable. A solid made in Studio is driven by its sketch — the
 * profile contour on a view, with the closed contours inside it as holes
 * (and the face over them, when one was made) — and by its operation:
 * EXTRUDE (depth), SWEEP (along a path) or REVOLVE (about an axis, through
 * an angle). Every step lives in the drafts (`params` of the profile), so
 * changing any of them rebuilds the element in place
 * (`useLinkedElementSync`): same element, same GlobalId.
 *
 * Here: read a solid's steps back from its element, change an operation's
 * parameter, and open its sketch for editing — the view it was drawn on,
 * with the sketch's contours selected and in frame (a double click on the
 * solid does it too).
 */

import { create } from 'zustand';
import { useViewerStore } from '@/store';
import { setDraftParams } from '@/drafting/draft-store';
import { shapeLoop } from '@/drafting/commands/model';
import { faceOuterId } from '@/drafting/faces';
import { pointInPolygon } from '@/drafting/offset';
import type { DraftEntity, DraftParamValue, Pt } from '@/drafting/types';
import { ELEMENT_DOUBLE_CLICK_EVENT } from '@/components/viewer/selectionHandlers';
import { useProjectStore } from './project-store';
import { findElementByGlobalId } from './contour-element';
import { openProjectView } from './open-view';
import type { ProjectView } from './types';

export type StudioOperation = 'extrude' | 'sweep' | 'revolve';

export interface StudioFeature {
  modelId: string;
  elementId: number;
  view: ProjectView;
  operation: StudioOperation;
  ifcClass: string;
  /** The sketch: its outer contour and the holes drawn inside it. */
  profile: DraftEntity;
  holes: DraftEntity[];
  /** The face made over the contour, when one was. */
  face: DraftEntity | null;
  /** A sweep's path, or a revolve's axis. */
  guide: DraftEntity | null;
  /** Extrusion length (m), negative away from the viewer. */
  depth?: number;
  /** A revolve's sweep, degrees. */
  angle?: number;
}

const loopOf = (e: DraftEntity): Pt[] | null => (e.shape.type === 'polyline' || e.shape.type === 'circle' ? shapeLoop(e.shape) : null);

/** The closed contours directly inside a profile: its holes (as `contourLoops` takes them). */
export function holeEntities(profile: DraftEntity, drafts: readonly DraftEntity[]): DraftEntity[] {
  const outer = loopOf(profile);
  if (!outer) return [];
  const inside = drafts
    .filter((e) => e.id !== profile.id && e.viewId === profile.viewId && !e.params.ifcGlobalId)
    .map((e) => ({ e, loop: loopOf(e) }))
    .filter((x): x is { e: DraftEntity; loop: Pt[] } => !!x.loop && x.loop.every((p) => pointInPolygon(p, outer)));
  return inside.filter((x) => !inside.some((o) => o !== x && x.loop.every((p) => pointInPolygon(p, o.loop)))).map((x) => x.e);
}

/** The operation a linked profile drives, or null for a link Studio does not own (roofs, corridors…). */
function operationOf(p: DraftEntity['params']): StudioOperation | null {
  if (p.roofSystem || p.corridor || p.roofKind) return null;
  if (p.solid === 'sweep' || p.solid === 'revolve') return p.solid;
  return Number.isFinite(Number(p.depth)) && Number(p.depth) !== 0 ? 'extrude' : null;
}

/** The Studio history of a profile already known to drive an element. */
export function featureOfProfile(profile: DraftEntity, drafts: readonly DraftEntity[], views: readonly ProjectView[], elementId: number): StudioFeature | null {
  const p = profile.params;
  const operation = operationOf(p);
  const view = views.find((v) => v.id === profile.viewId);
  if (!operation || !view) return null;
  const guideId = operation === 'sweep' ? p.path : operation === 'revolve' ? p.axis : undefined;
  return {
    modelId: String(p.ifcModelId),
    elementId,
    view,
    operation,
    ifcClass: String(p.ifcClass ?? 'IfcBuildingElementProxy'),
    profile,
    holes: holeEntities(profile, drafts),
    face: drafts.find((d) => faceOuterId(d) === profile.id) ?? null,
    guide: drafts.find((d) => d.id === guideId) ?? null,
    depth: operation === 'extrude' ? Number(p.depth) : undefined,
    angle: operation === 'revolve' ? Number(p.angle ?? 360) : undefined,
  };
}

/** The Studio history of a model element, or null when it was not built in Studio. */
export function studioFeatureOf(modelId: string, elementId: number): StudioFeature | null {
  const { drafts, views } = useProjectStore.getState();
  for (const d of drafts) {
    if (d.params.ifcModelId !== modelId || typeof d.params.ifcGlobalId !== 'string') continue;
    if (findElementByGlobalId(modelId, d.params.ifcGlobalId) !== elementId) continue;
    return featureOfProfile(d, drafts, views, elementId);
  }
  return null;
}

/** Change one of a step's parameters (depth, angle, class): the element rebuilds from it. */
export function setFeatureParam(feature: StudioFeature, key: 'depth' | 'angle' | 'ifcClass', value: DraftParamValue): void {
  setDraftParams(new Set([feature.profile.id]), { [key]: value });
}

/** The drafts a sketch is made of: the profile, its holes and its path or axis. */
export const sketchIds = (f: StudioFeature): string[] => [f.profile.id, ...f.holes.map((h) => h.id), ...(f.guide ? [f.guide.id] : [])];

/** A sketch waiting to be shown once its view's drawing tab is up. */
export const useSketchFocus = create<{ viewId: string | null; ids: string[] }>()(() => ({ viewId: null, ids: [] }));

/** Open a solid's sketch: its view in front, the sketch selected and in frame. */
export function editSketch(feature: StudioFeature): void {
  useSketchFocus.setState({ viewId: feature.view.id, ids: sketchIds(feature) });
  openProjectView(feature.view.id);
}

/** Double click on a face: its sketch (the contour and its holes) selected. */
export function sketchOfFace(face: DraftEntity, drafts: readonly DraftEntity[]): string[] {
  const outer = drafts.find((d) => d.id === faceOuterId(face));
  return outer ? [outer.id, ...holeEntities(outer, drafts).map((h) => h.id)] : [];
}

let installed = false;
/** Mount once: a double click on a Studio solid opens its sketch. */
export function installStudioFeatures(): void {
  if (installed) return;
  installed = true;
  window.addEventListener(ELEMENT_DOUBLE_CLICK_EVENT, (e) => {
    const renderId = (e as CustomEvent<number>).detail;
    if (typeof renderId !== 'number') return;
    const ref = useViewerStore.getState().resolveGlobalIdFromModels(renderId);
    const feature = ref ? studioFeatureOf(ref.modelId, ref.expressId) : null;
    if (feature) editSketch(feature);
  });
}
