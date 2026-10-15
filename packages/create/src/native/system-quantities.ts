/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The base quantities of a native system (N3), from its family's spec: a
 * railing's length along its path, a roof's sloped and plan areas over its
 * planes (`roofGeometry`, overhangs included), a curtain wall's length,
 * height and face. The families whose standard quantities would need their
 * built parts (a truss, a corridor, a stair) give none.
 */

import { QuantityType } from '@ifc-lite/data';
import { roofGeometry, type RoofEdgeRule } from '../in-store/roof-system.js';
import type { NativeSystem } from './schema.js';

type V3 = readonly [number, number, number];
interface Quantity { name: string; value: number; quantityType: QuantityType }

const length = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Length });
const area = (name: string, value: number): Quantity => ({ name, value, quantityType: QuantityType.Area });
const isPoint = (v: unknown, n: 2 | 3): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const points = <N extends 2 | 3>(v: unknown, n: N) => (Array.isArray(v) && v.every((p) => isPoint(p, n)) ? (v as number[][]) : null);
const positive = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** A planar polygon's area (Newell's normal, half its length). */
function polygonArea(pts: readonly V3[]): number {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return Math.hypot(n[0], n[1], n[2]) / 2;
}

const planArea = (pts: readonly V3[]) => polygonArea(pts.map(([x, y]) => [x, y, 0] as const));

/** `e`'s base quantity set, or null when its family gives none (or its spec cannot be read). */
export function systemQuantities(e: NativeSystem): { set: string; quantities: Quantity[] } | null {
  const spec = e.spec;
  if (e.family === 'railing') {
    const path = points(spec.Path, 3);
    if (!path || path.length < 2) return null;
    const len = path.slice(1).reduce((sum, b, i) => sum + Math.hypot(b[0] - path[i][0], b[1] - path[i][1], b[2] - path[i][2]), 0);
    return { set: 'Qto_RailingBaseQuantities', quantities: [length('Length', len)] };
  }
  if (e.family === 'roof') {
    const outline = points(spec.outline, 2);
    if (!outline || !Array.isArray(spec.rules)) return null;
    try {
      const planes = roofGeometry(outline as [number, number][], spec.rules as RoofEdgeRule[]).planes.map((p) => p.pts as V3[]);
      return { set: 'Qto_RoofBaseQuantities', quantities: [
        area('GrossArea', planes.reduce((sum, p) => sum + polygonArea(p), 0)),
        area('ProjectedArea', planes.reduce((sum, p) => sum + planArea(p), 0)),
      ] };
    } catch {
      return null;
    }
  }
  if (e.family === 'curtainWall') {
    const [start, end, height] = [spec.start, spec.end, positive(spec.height)];
    if (!isPoint(start, 3) || !isPoint(end, 3) || height === null) return null;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    return { set: 'Qto_CurtainWallQuantities', quantities: [length('Length', len), length('Height', height), area('GrossSideArea', len * height)] };
  }
  return null;
}
