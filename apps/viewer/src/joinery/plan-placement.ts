/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A configured door's or window's plan symbol (`symbols.ts`) put where the
 * element is: its placement's axes come from the mesh's `localToWorld`
 * (row-major, WebGL Y-up: IFC local X is column 0, IFC local Y is minus
 * column 2), and its origin from the mesh itself — the body's extent along
 * those axes against the type's own extent. So the interior side, the hinge
 * side and the cut height are the element's real ones.
 */

import { flipPoint, joineryBoxes, type JoinerySpec } from '@ifc-lite/create';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import { worldToDrawing } from '@/drafting/frame';
import type { DraftShape, Pt } from '@/drafting/types';
import { planSymbol } from './symbols';

export interface TypedPlanSymbol {
  thin: DraftShape[];
  heavy: DraftShape[];
  dashed: DraftShape[];
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(v: V3): V3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null;
}

/** `world`: the element's vertices (flat x, y, z, renderer frame); `flips`: how its mapped body is turned (`emitMappedBody`). */
export function typedPlanSymbol(
  spec: JoinerySpec, world: readonly number[], localToWorld: readonly number[], plane: SectionPlaneConfig, flips = 0,
): TypedPlanSymbol | null {
  const m = localToWorld;
  const ex = unit([m[0], m[4], m[8]]);
  const ez = unit([-m[2], -m[6], -m[10]]);
  const up = unit([m[1], m[5], m[9]]);
  // A plan symbol needs an upright element.
  if (!ex || !ez || !up || Math.abs(up[1]) < 0.99) return null;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, minC = Infinity;
  for (let i = 0; i + 2 < world.length; i += 3) {
    const v: V3 = [world[i], world[i + 1], world[i + 2]];
    const a = dot(v, ex), b = dot(v, ez), c = dot(v, up);
    minA = Math.min(minA, a); maxA = Math.max(maxA, a);
    minB = Math.min(minB, b); minC = Math.min(minC, c);
  }
  if (!Number.isFinite(minA)) return null;
  const boxes = joineryBoxes(spec);
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  // The body as turned in its opening.
  for (const b of boxes) for (const [x, y] of [[b.min[0], b.min[1]], [b.max[0], b.max[1]]]) {
    const [fx, fy] = flipPoint(x, y, flips);
    xMin = Math.min(xMin, fx); xMax = Math.max(xMax, fx);
    yMin = Math.min(yMin, fy); yMax = Math.max(yMax, fy);
  }
  const tx = (minA + maxA) / 2 - (xMin + xMax) / 2;
  const ty = minB - yMin;
  const level = plane.position;
  const cutZ = (level - minC) / up[1];
  if (cutZ < 0 || cutZ > spec.height) return null;
  const toDrawing = (p: { x: number; y: number }): Pt => {
    const [x, y] = flipPoint(p.x, p.y, flips);
    const w: V3 = [
      ex[0] * (x + tx) + ez[0] * (y + ty),
      level,
      ex[2] * (x + tx) + ez[2] * (y + ty),
    ];
    return worldToDrawing(plane, { x: w[0], y: w[1], z: w[2] });
  };
  const out: TypedPlanSymbol = { thin: [], heavy: [], dashed: [] };
  for (const s of planSymbol(spec, { cutZ })) {
    const shape: DraftShape = { type: 'polyline', pts: s.pts.map(toDrawing), closed: !!s.closed };
    (s.dashed ? out.dashed : s.weight === 'cut' ? out.heavy : out.thin).push(shape);
  }
  return out;
}
