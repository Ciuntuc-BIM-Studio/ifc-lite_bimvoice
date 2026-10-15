/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The section a solid's sketch is drawn on when no view of the project holds
 * it ("Edit sketch", `sketch-recovery.ts`): through the plane of its history
 * — an extrusion's profile plane (square to its axis), a sweep's path, a
 * revolve's profile and axis — in the viewer's world frame. A cardinal plane
 * is a plain section along its axis; any other is a custom one.
 */

import type { NativeSolidShape } from '@ifc-lite/create';
import { planeBasis } from '@ifc-lite/renderer';
import { useViewerStore } from '@/store';
import { buildStoreyWorkplane } from '@/lib/commands/modeling/workplane';
import type { SectionPlaneAxis } from '@/store/types';
import { addProjectView } from './project-store';
import type { SectionProjectPlane } from './types';

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 | null => { const l = Math.hypot(...a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
const UP: V3 = [0, 1, 0];

/** The normal of the plane through `pts` (world), or null when they lie on a line. */
function normalThrough(pts: readonly V3[]): V3 | null {
  let best: V3 | null = null, size = 0;
  for (let i = 1; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const n = cross(sub(pts[i], pts[0]), sub(pts[j], pts[0]));
      const l = Math.hypot(...n);
      if (l > size) { size = l; best = n; }
    }
  }
  return best && size > 1e-9 ? unit(best) : null;
}

/** The sketch plane of `shape` (storey frame), in world: a point on it and its normal. */
function sketchPlane(shape: NativeSolidShape, world: (p: readonly number[]) => V3): { point: V3; normal: V3 } | null {
  if (shape.operation === 'extrude') {
    const point = world(shape.location);
    const normal = unit(sub(world(shape.location.map((v, i) => v + shape.axis[i])), point));
    return normal ? { point, normal } : null;
  }
  const pts = shape.operation === 'sweep'
    ? shape.path.map(world)
    : [...shape.profile, shape.origin, shape.origin.map((v, i) => v + shape.direction[i])].map(world);
  const normal = normalThrough(pts);
  if (normal) return { point: pts[0], normal };
  // A straight path: the upright plane along it.
  const along = unit(sub(pts[pts.length - 1], pts[0]));
  const upright = along ? unit(cross(along, UP)) : null;
  return upright ? { point: pts[0], normal: upright } : null;
}

const CARDINAL: ReadonlyArray<[SectionPlaneAxis, number]> = [['side', 0], ['down', 1], ['front', 2]];

/** Add a section view through `shape`'s sketch plane; its id, or null when the plane cannot be found. */
export function addSketchSection(modelId: string, storeyId: number, shape: NativeSolidShape, name: string): string | null {
  const workplane = buildStoreyWorkplane(useViewerStore.getState(), modelId, storeyId, 0);
  if ('refused' in workplane) return null;
  const plane = sketchPlane(shape, (p) => {
    const r = workplane.localToRender([p[0], p[1], p[2]]);
    return [r[0], r[1], r[2]];
  });
  if (!plane) return null;
  const { point, normal } = plane;
  const cardinal = CARDINAL.find(([, i]) => Math.abs(Math.abs(normal[i]) - 1) < 1e-6);
  let section: SectionProjectPlane;
  if (cardinal) {
    section = { axis: cardinal[0], offset: point[cardinal[1]], flipped: false };
  } else {
    const basis = planeBasis(normal);
    section = {
      axis: 'front', offset: point[2], flipped: false,
      custom: { normal, distance: dot(point, normal), pickedAt: point, tangent: basis.tangent, bitangent: basis.bitangent },
    };
  }
  return addProjectView({ kind: 'section', name, plane: section });
}
