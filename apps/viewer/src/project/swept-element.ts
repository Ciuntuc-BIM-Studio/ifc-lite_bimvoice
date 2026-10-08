/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sweeps and revolves from drafted shapes (phase 6, after the extrusion):
 *
 *  - SWEEP: a closed profile carried along a path (a line, polyline or arc)
 *    drawn on the view's work plane. The profile stands upright on the path:
 *    its drawing as seen on screen — right is to the path's left, up is up —
 *    with the bottom centre of its bounding box on the path.
 *  - REVOLVE: a closed profile turned about an axis line, both drawn on the
 *    view's plane (a section's profile about a vertical axis makes a column).
 *
 * The element is an IfcFacetedBrep (`faceted-element.ts`) linked to its
 * profile by GlobalId; the profile carries `solid`, `path` / `axis` (draft
 * ids) and `angle`, and editing the profile, the path or the axis rebuilds it.
 */

import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { revolveFaces, sweepFaces } from '@ifc-lite/create';
import { drawingToUserVec, drawingToWorld, type SectionAxisName, type Vec3 } from '@/drafting/frame';
import type { DraftEntity, Pt } from '@/drafting/types';
import { shapeSegments } from '@/hooks/useDraftingLines3D';
import type { ContourElementResult } from './contour-element';
import { createFacetedElement, updateFacetedElement, type FacetedBuild } from './faceted-element';
import type { ProjectView } from './types';

type V3 = [number, number, number];
const AXIS: Record<string, SectionAxisName> = { y: 'down', z: 'front', x: 'side' };
const tuple = (p: Vec3): V3 => [p.x, p.y, p.z];

/** A path shape as points, and whether it closes. */
export function pathPoints(path: DraftEntity): { pts: Pt[]; closed: boolean } | null {
  const s = path.shape;
  if (s.type === 'line') return { pts: [s.a, s.b], closed: false };
  if (s.type === 'polyline') return s.pts.length >= 2 ? { pts: s.pts, closed: s.closed } : null;
  if (s.type === 'arc' || s.type === 'circle') {
    const segments = shapeSegments(s);
    return { pts: [segments[0][0], ...segments.map(([, b]) => b)], closed: s.type === 'circle' };
  }
  return null;
}

/** The profile as seen on screen (x right, y up), its bounding box's bottom centre at the origin. */
function screenProfile(profile: Pt[], plane: SectionPlaneConfig): [number, number][] {
  const axis = AXIS[plane.axis] ?? 'front';
  const user = profile.map((p) => drawingToUserVec(p, axis));
  const xs = user.map((p) => p.x), ys = user.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, by = Math.min(...ys);
  return user.map((p) => [p.x - cx, p.y - by]);
}

export function sweepBuild(profile: Pt[], path: { pts: Pt[]; closed: boolean }, plane: SectionPlaneConfig): FacetedBuild {
  return (toLocal) => ({
    faces: sweepFaces(screenProfile(profile, plane), path.pts.map((p) => tuple(toLocal(drawingToWorld(plane, p)))), { closed: path.closed }),
    location: [0, 0, 0],
  });
}

export function revolveBuild(profile: Pt[], axis: [Pt, Pt], angleDeg: number, plane: SectionPlaneConfig): FacetedBuild {
  return (toLocal) => {
    const lift = (p: Pt) => tuple(toLocal(drawingToWorld(plane, p)));
    const a = lift(axis[0]), b = lift(axis[1]);
    return {
      faces: revolveFaces(profile.map(lift), a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], (angleDeg * Math.PI) / 180),
      location: [0, 0, 0],
    };
  };
}

export interface SweptSpec {
  ifcClass: string;
}

export function createSweptElement(
  view: ProjectView, plane: SectionPlaneConfig, profile: Pt[], build: FacetedBuild, kind: 'sweep' | 'revolve', spec: SweptSpec, sourceId: string,
): ContourElementResult {
  return createFacetedElement(view, plane, profile, build, {
    ifcClass: spec.ifcClass,
    authoring: [{ name: 'Solid', value: kind, type: 'LABEL' }],
  }, sourceId);
}

export function updateSweptElement(
  view: ProjectView, plane: SectionPlaneConfig, profile: Pt[], build: FacetedBuild, ifcClass: string, modelId: string, globalId: string,
): ContourElementResult {
  return updateFacetedElement(view, plane, profile, build, ifcClass, modelId, globalId);
}

/** Rebuild the faces of a linked profile from the current drafts, or null when its path / axis is gone. */
export function sweptBuildOf(profileDraft: DraftEntity, profile: Pt[], drafts: readonly DraftEntity[], plane: SectionPlaneConfig): FacetedBuild | null {
  const p = profileDraft.params;
  if (p.solid === 'sweep') {
    const path = drafts.find((d) => d.id === p.path);
    const pts = path ? pathPoints(path) : null;
    return pts ? sweepBuild(profile, pts, plane) : null;
  }
  if (p.solid === 'revolve') {
    const axis = drafts.find((d) => d.id === p.axis);
    if (axis?.shape.type !== 'line') return null;
    return revolveBuild(profile, [axis.shape.a, axis.shape.b], Number(p.angle ?? 360), plane);
  }
  return null;
}
