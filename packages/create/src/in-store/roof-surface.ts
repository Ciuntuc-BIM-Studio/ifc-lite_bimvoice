/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Roof geometry over a plan outline, pure (metres, the outline's own plane,
 * z up). A roof is its top SURFACE — planar facets over the outline, z = 0
 * at the eaves — and a solid made from it: the facets lifted by the
 * (vertical) thickness on top, the same facets underneath, and a vertical
 * face along every edge of the surface's boundary, so gable ends close
 * themselves.
 *
 *  - `flat`:  one facet at z = 0.
 *  - `mono`:  one facet rising from edge `eaveEdge` across the outline (any outline).
 *  - `gable`: two facets meeting at a ridge along the long axis (a rectangle).
 *  - `hip`:   one facet per outline edge, any simple outline — the faces of
 *             its straight skeleton (`straight-skeleton.ts`): hips, valleys, ridges.
 *
 * `overhang` pushes the eaves out past the outline (a mitred offset).
 */

import { hipRoofFaces } from './straight-skeleton.js';

export type RoofKind = 'flat' | 'mono' | 'gable' | 'hip';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

export interface RoofSurfaceSpec {
  kind: RoofKind;
  /** Pitch, radians, 0 ≤ slope < π/2. Ignored for `flat`. */
  slope: number;
  /** Eave edge of a `mono` roof: outline edge i runs from point i to i + 1. Default 0. */
  eaveEdge?: number;
  /** Eaves past the outline, metres (≥ 0). Default 0. */
  overhang?: number;
}

const EPS = 1e-9;

function signedArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** The outline counter-clockwise, without a repeated closing point. */
function ccw(outline: readonly Vec2[]): Vec2[] {
  const pts = outline.map((p) => [p[0], p[1]] as Vec2);
  const first = pts[0], last = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < EPS) pts.pop();
  if (pts.length < 3) throw new Error('roof: the outline needs at least 3 points');
  if (Math.abs(signedArea(pts)) < EPS) throw new Error('roof: the outline has no area');
  return signedArea(pts) > 0 ? pts : pts.reverse();
}

/** A rectangle's centre, long-axis unit vector and half sizes, or null when `pts` is not a rectangle. */
function rectangle(pts: readonly Vec2[]): { c: Vec2; u: Vec2; v: Vec2; hl: number; hw: number } | null {
  if (pts.length !== 4) return null;
  const e = pts.map((p, i) => [pts[(i + 1) % 4][0] - p[0], pts[(i + 1) % 4][1] - p[1]] as Vec2);
  const len = e.map((d) => Math.hypot(d[0], d[1]));
  for (let i = 0; i < 4; i++) {
    const d = e[i], n = e[(i + 1) % 4];
    if (Math.abs(d[0] * n[0] + d[1] * n[1]) > 1e-6 * len[i] * len[(i + 1) % 4]) return null;
  }
  const long = len[0] >= len[1] ? 0 : 1;
  const u: Vec2 = [e[long][0] / len[long], e[long][1] / len[long]];
  const v: Vec2 = [-u[1], u[0]];
  const c: Vec2 = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
  return { c, u, v, hl: len[long] / 2, hw: len[1 - long] / 2 };
}

/** Drop consecutive repeated points (a hip over a square collapses its ridge). */
function dedupe(loop: Vec3[]): Vec3[] {
  return loop.filter((p, i) => {
    const q = loop[(i + loop.length - 1) % loop.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > EPS;
  });
}

/** The roof's top surface: planar facets, each counter-clockwise seen from above. */
/** `pts` (counter-clockwise) offset outward by `d`, corners mitred. */
export function offsetOutline(pts: readonly Vec2[], d: number): Vec2[] {
  if (!(d > 0)) return pts.map((p) => [p[0], p[1]]);
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    // Outward is right of a counter-clockwise edge.
    return { p: [a[0] + dir[1] * d, a[1] - dir[0] * d] as Vec2, dir };
  });
  return pts.map((_, i) => {
    const l1 = lines[(i + n - 1) % n], l2 = lines[i];
    const den = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
    if (Math.abs(den) < 1e-12) return l2.p;
    const t = ((l2.p[0] - l1.p[0]) * l2.dir[1] - (l2.p[1] - l1.p[1]) * l2.dir[0]) / den;
    return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t];
  });
}

export function roofFacets(outline: readonly Vec2[], spec: RoofSurfaceSpec): Vec3[][] {
  const pts = offsetOutline(ccw(outline), spec.overhang ?? 0);
  if (spec.kind !== 'flat' && !(spec.slope >= 0 && spec.slope < Math.PI / 2 - 1e-6)) {
    throw new Error('roof: the slope must be between 0° and 90°');
  }
  const k = Math.tan(spec.slope);
  switch (spec.kind) {
    case 'flat':
      return [pts.map(([x, y]) => [x, y, 0])];
    case 'mono': {
      const i = ((spec.eaveEdge ?? 0) % pts.length + pts.length) % pts.length;
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // The outline runs counter-clockwise, so its inside is left of every edge.
      const n: Vec2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      return [pts.map(([x, y]) => [x, y, k * ((x - a[0]) * n[0] + (y - a[1]) * n[1])])];
    }
    case 'hip':
      return hipRoofFaces(pts, spec.slope).map(dedupe).filter((f) => f.length >= 3);
    case 'gable': {
      const r = rectangle(pts);
      if (!r) throw new Error('roof: a gable roof needs a rectangular outline');
      const h = k * r.hw;
      const E = (s: number, t: number, z: number): Vec3 => [r.c[0] + r.u[0] * s + r.v[0] * t, r.c[1] + r.u[1] * s + r.v[1] * t, z];
      const { hl, hw } = r;
      return [
        [E(-hl, -hw, 0), E(hl, -hw, 0), E(hl, 0, h), E(-hl, 0, h)],
        [E(hl, hw, 0), E(-hl, hw, 0), E(-hl, 0, h), E(hl, 0, h)],
      ];
    }
  }
}

const key = (p: Vec3) => `${p[0].toFixed(9)},${p[1].toFixed(9)},${p[2].toFixed(9)}`;

/**
 * The closed shell of a roof `thickness` thick (vertical) over `facets`:
 * every face a planar loop wound counter-clockwise seen from outside.
 */
export function roofSolidFaces(facets: readonly Vec3[][], thickness: number): Vec3[][] {
  if (!(thickness > 0) || !Number.isFinite(thickness)) throw new Error('roof: the thickness must be positive');
  const up = (p: Vec3): Vec3 => [p[0], p[1], p[2] + thickness];
  const faces: Vec3[][] = [];
  const edges = new Map<string, { p: Vec3; q: Vec3; count: number }>();
  for (const facet of facets) {
    faces.push(facet.map(up));
    faces.push([...facet].reverse());
    facet.forEach((p, i) => {
      const q = facet[(i + 1) % facet.length];
      const forward = `${key(p)}|${key(q)}`, backward = `${key(q)}|${key(p)}`;
      const shared = edges.get(backward);
      if (shared) shared.count++;
      else edges.set(forward, { p, q, count: 1 });
    });
  }
  // A boundary edge belongs to one facet; it runs counter-clockwise, so outside is on its right.
  for (const { p, q, count } of edges.values()) {
    if (count === 1) faces.push([p, q, up(q), up(p)]);
  }
  return faces;
}
