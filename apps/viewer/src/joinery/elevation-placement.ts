/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A door's or window's elevation symbol (`symbols.ts`: frame, panels and the
 * opening marks) put where the element is on an elevation or section view
 * looking at its face: the element's axes come from the mesh's
 * `localToWorld` as in `plan-placement.ts`, its centre and sill from the
 * mesh. The marks are solid where a panel opens towards the viewer and
 * dashed where it opens away, so the side the view sees it from decides.
 */

import { flipPoint, type JoinerySpec } from '@ifc-lite/create';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { worldToDrawing } from '@/drafting/frame';
import type { DraftShape } from '@/drafting/types';
import { elevationSymbol, type OpeningConvention } from './symbols';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function unit(v: V3): V3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

const AXIS: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** The world direction towards the viewer of a cardinal elevation / section (`worldToDrawing` with the screen's signs). */
function towardViewer(plane: SectionPlaneConfig): V3 | null {
  if (plane.customPlane || plane.axis === 'y') return null;
  const u = plane.axis === 'x' ? AXIS.z : AXIS.x;
  // Screen right: drawing x (±u), mirrored on screen for side views (`screenSigns`); screen up: world y.
  const sign = (plane.flipped ? -1 : 1) * (plane.axis === 'x' ? -1 : 1);
  return cross([u[0] * sign, u[1] * sign, u[2] * sign], AXIS.y);
}

export interface ElevationPlacementOptions {
  convention?: OpeningConvention;
}

/** `world`: the element's vertices (flat x, y, z, renderer frame); `flips`: how its body is turned in its opening. */
export function typedElevationSymbol(
  spec: JoinerySpec, world: readonly number[], localToWorld: readonly number[], plane: SectionPlaneConfig, flips = 0,
  options: ElevationPlacementOptions = {},
): { thin: DraftShape[]; dashed: DraftShape[] } | null {
  const toViewer = towardViewer(plane);
  const m = localToWorld;
  const ex = unit([m[0], m[4], m[8]]);
  const ez = unit([-m[2], -m[6], -m[10]]);
  const up = unit([m[1], m[5], m[9]]);
  if (!toViewer || !ex || !ez || !up || Math.abs(up[1]) < 0.99) return null;
  // Only an element whose face the view looks at (not one seen edge-on).
  const facing = dot(ez, toViewer);
  if (Math.abs(facing) < 0.9) return null;
  let minA = Infinity, maxA = -Infinity, minC = Infinity;
  for (let i = 0; i + 2 < world.length; i += 3) {
    const v: V3 = [world[i], world[i + 1], world[i + 2]];
    const a = dot(v, ex), c = dot(v, up);
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minC = Math.min(minC, c);
  }
  if (!Number.isFinite(minA)) return null;
  // The type frame's +y is the exterior; the element's flips may turn it.
  const [fx, fy] = flipPoint(0, 1, flips);
  const exterior = (fy * facing + fx * dot(ex, toViewer)) > 0;
  // A body turned left-right mirrors its marks along the width.
  const [mx] = flipPoint(1, 0, flips);
  const strokes = elevationSymbol(spec, { side: exterior ? 'exterior' : 'interior', convention: options.convention });
  const mid = (minA + maxA) / 2;
  const toDrawing = (p: { x: number; y: number }) => {
    // `elevationSymbol` mirrors an exterior view itself; the world placement mirrors again, so undo it here.
    const x = (exterior ? -p.x : p.x) * mx + mid;
    const z = p.y + minC;
    const w: V3 = [ex[0] * x + up[0] * z, ex[1] * x + up[1] * z, ex[2] * x + up[2] * z];
    return worldToDrawing(plane, { x: w[0], y: w[1], z: w[2] });
  };
  const out = { thin: [] as DraftShape[], dashed: [] as DraftShape[] };
  for (const s of strokes) {
    const shape: DraftShape = { type: 'polyline', pts: s.pts.map(toDrawing), closed: !!s.closed };
    (s.dashed ? out.dashed : out.thin).push(shape);
  }
  return out;
}
