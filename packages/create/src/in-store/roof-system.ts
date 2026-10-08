/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system: one outline (the wall-plate line, z = 0) and a rule per
 * outline edge — an EAVE with its pitch and overhang, or a GABLE (a vertical
 * end; its overhang is the rake). The roof planes follow from the rules as a
 * weighted straight skeleton (`weightedSkeletonFaces`): an eave edge moves
 * in at 1 / tan(pitch), a gable stays put, so hips, valleys and ridges land
 * where planes of different pitches really meet.
 *
 * Overhangs: every plane passes through its wall-plate edge at z = 0 and
 * drops by tan(pitch) × overhang to its eave. The skeleton runs on the
 * outline pushed out so that every eave edge sits at the same height (the
 * deepest eave), then each plane is cut back to its own eave line — so
 * different overhangs and pitches still meet on true plane intersections.
 *
 * Coordinates are the outline's plane (metres), z up from the wall plate.
 */

import { weightedSkeletonFaces } from './straight-skeleton.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

export type RoofEdgeKind = 'eave' | 'gable';

export interface RoofEdgeRule {
  kind: RoofEdgeKind;
  /** Pitch in degrees (eaves; 1° … 85°). */
  pitch: number;
  /** Horizontal overhang past the wall plate, metres (a gable's is the rake). */
  overhang: number;
}

export interface RoofPlane {
  /** The outline edge the plane rises from. */
  edge: number;
  /** Its surface (counter-clockwise seen from above), from the eave up. */
  pts: Vec3[];
  /** Pitch, degrees. */
  pitch: number;
}

export interface RoofLine {
  kind: 'ridge' | 'hip' | 'valley' | 'eave' | 'verge';
  a: Vec3;
  b: Vec3;
}

export interface RoofGeometry {
  planes: RoofPlane[];
  /** Gable ends: vertical triangles over the wall line of each gable edge. */
  gables: { edge: number; pts: Vec3[] }[];
  /** The plan lines of the roof (ridges, hips, valleys, eaves, verges). */
  lines: RoofLine[];
  /** The outline, counter-clockwise, and its rules in the same order. */
  outline: Vec2[];
  rules: RoofEdgeRule[];
}

const EPS = 1e-9;

function signedArea(pts: readonly Vec2[]): number {
  return pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
}

/** The outline counter-clockwise with its rules (edge i: point i → i + 1); a repeated closing point dropped. */
export function orientRoof(outline: readonly Vec2[], rules: readonly RoofEdgeRule[]): { outline: Vec2[]; rules: RoofEdgeRule[] } {
  let pts = outline.map((p) => [p[0], p[1]] as Vec2);
  let rs = [...rules];
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < EPS) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) throw new Error('roof: the outline needs at least 3 corners');
  while (rs.length < pts.length) rs.push(rs[rs.length - 1] ?? { kind: 'eave', pitch: 30, overhang: 0.5 });
  rs = rs.slice(0, pts.length);
  if (signedArea(pts) < 0) {
    const n = pts.length;
    pts = pts.reverse();
    rs = pts.map((_, j) => rs[(2 * n - 2 - j) % n]);
  }
  return { outline: pts, rules: rs };
}

/** `pts` with edge i pushed out (right of the counter-clockwise edge) by `d[i]`, corners on the offset lines' intersections. */
export function offsetEdges(pts: readonly Vec2[], d: readonly number[]): Vec2[] {
  const n = pts.length;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    return { p: [a[0] + dir[1] * d[i], a[1] - dir[0] * d[i]] as Vec2, dir };
  });
  return pts.map((_, i) => {
    const l1 = lines[(i + n - 1) % n], l2 = lines[i];
    const den = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
    if (Math.abs(den) < 1e-12) return l2.p;
    const t = ((l2.p[0] - l1.p[0]) * l2.dir[1] - (l2.p[1] - l1.p[1]) * l2.dir[0]) / den;
    return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t];
  });
}

/** Keep the part of a planar loop on the side `inside(p) ≥ 0` (Sutherland–Hodgman, one half-plane). */
function clipHalf(loop: readonly Vec3[], inside: (p: Vec3) => number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i], q = loop[(i + 1) % loop.length];
    const dp = inside(p), dq = inside(q);
    if (dp >= -EPS) out.push(p);
    if ((dp >= -EPS) !== (dq >= -EPS)) {
      const t = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
    }
  }
  return out.filter((p, i) => Math.hypot(p[0] - out[(i + out.length - 1) % out.length][0], p[1] - out[(i + out.length - 1) % out.length][1], p[2] - out[(i + out.length - 1) % out.length][2]) > 1e-9);
}

export function roofProblem(outline: readonly Vec2[], rules: readonly RoofEdgeRule[]): string | null {
  if (outline.length < 3) return 'The outline needs at least 3 corners';
  if (!rules.some((r) => r.kind === 'eave')) return 'At least one edge must be an eave';
  for (const r of rules) {
    if (r.kind === 'eave' && !(r.pitch >= 1 && r.pitch <= 85)) return 'Eave pitches must be between 1° and 85°';
    if (!(r.overhang >= 0) || r.overhang > 5) return 'Overhangs must be between 0 and 5 m';
  }
  return null;
}

/** The roof over `outline` with its per-edge rules. */
export function roofGeometry(outline: readonly Vec2[], rules: readonly RoofEdgeRule[]): RoofGeometry {
  const oriented = orientRoof(outline, rules);
  const problem = roofProblem(oriented.outline, oriented.rules);
  if (problem) throw new Error(`roof: ${problem}`);
  const pts = oriented.outline, rs = oriented.rules, n = pts.length;
  const tan = rs.map((r) => (r.kind === 'eave' ? Math.tan((r.pitch * Math.PI) / 180) : Infinity));
  // The deepest eave: every eave edge is pushed out to the line where its plane is that low.
  const drop = Math.max(0, ...rs.map((r, i) => (r.kind === 'eave' ? r.overhang * tan[i] : 0)));
  const push = rs.map((r, i) => (r.kind === 'eave' ? drop / tan[i] : r.overhang));
  const work = offsetEdges(pts, push);
  const faces = weightedSkeletonFaces(work, rs.map((r, i) => (r.kind === 'eave' ? 1 / tan[i] : 0)));
  const edgeLine = (i: number) => {
    const a = pts[i], b = pts[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { a, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l] as Vec2, n: [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] as Vec2 };
  };
  const planes: RoofPlane[] = [];
  const gables: { edge: number; pts: Vec3[] }[] = [];
  faces.forEach((face, i) => {
    if (face.length < 3) return;
    const lifted = face.map(([x, y, z]) => [x, y, z - drop] as Vec3);
    if (rs[i].kind === 'gable') {
      // The vertical end over the wall line: the face's apex height there.
      const e = edgeLine(i);
      const top = Math.max(...lifted.map((p) => p[2]));
      const apex = lifted.find((p) => Math.abs(p[2] - top) < 1e-9)!;
      const along = (apex[0] - e.a[0]) * e.d[0] + (apex[1] - e.a[1]) * e.d[1];
      const b = pts[(i + 1) % n];
      gables.push({ edge: i, pts: [[e.a[0], e.a[1], 0], [b[0], b[1], 0], [e.a[0] + e.d[0] * along, e.a[1] + e.d[1] * along, top]] });
      return;
    }
    const e = edgeLine(i);
    // Cut back to this edge's own eave line.
    const clipped = clipHalf(lifted, (p) => (p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1] + rs[i].overhang);
    if (clipped.length >= 3) planes.push({ edge: i, pts: clipped, pitch: rs[i].pitch });
  });
  return { planes, gables, lines: roofLines(planes), outline: pts, rules: rs };
}

/** Ridges, hips, valleys, eaves and verges: the edges of the planes, classified. */
function roofLines(planes: readonly RoofPlane[]): RoofLine[] {
  const key = (p: Vec3) => `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`;
  const seen = new Map<string, { a: Vec3; b: Vec3; planes: number[] }>();
  planes.forEach((plane, k) => {
    plane.pts.forEach((a, i) => {
      const b = plane.pts[(i + 1) % plane.pts.length];
      const id = [key(a), key(b)].sort().join('|');
      const entry = seen.get(id) ?? { a, b, planes: [] };
      entry.planes.push(k);
      seen.set(id, entry);
    });
  });
  const lines: RoofLine[] = [];
  for (const { a, b, planes: owners } of seen.values()) {
    const horizontal = Math.abs(a[2] - b[2]) < 1e-6;
    if (owners.length === 1) {
      lines.push({ kind: horizontal ? 'eave' : 'verge', a, b });
      continue;
    }
    if (horizontal) { lines.push({ kind: 'ridge', a, b }); continue; }
    // Hip or valley: just inside one plane, a hip (convex) has that plane below the other's extension, a valley above it.
    const [p1, p2] = owners.map((k) => planes[k]);
    const lo = a[2] < b[2] ? a : b, hi = a[2] < b[2] ? b : a;
    const z2 = planeOf(p2.pts);
    const c1 = p1.pts.reduce((s, p) => [s[0] + p[0] / p1.pts.length, s[1] + p[1] / p1.pts.length], [0, 0]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const d = [b[0] - a[0], b[1] - a[1]];
    const len = Math.hypot(d[0], d[1]) || 1;
    let nrm = [-d[1] / len, d[0] / len];
    if (nrm[0] * (c1[0] - mid[0]) + nrm[1] * (c1[1] - mid[1]) < 0) nrm = [-nrm[0], -nrm[1]];
    const z1 = planeOf(p1.pts);
    const q = [mid[0] + nrm[0] * 0.01, mid[1] + nrm[1] * 0.01];
    lines.push({ kind: z1(q[0], q[1]) < z2(q[0], q[1]) - 1e-9 ? 'hip' : 'valley', a: lo, b: hi });
  }
  return lines;
}

/** z over (x, y) on the plane through a planar loop. */
function planeOf(pts: readonly Vec3[]): (x: number, y: number) => number {
  // Newell's normal, robust for any planar polygon.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const o = pts[0];
  return (x, y) => (Math.abs(nz) < 1e-12 ? o[2] : o[2] - (nx * (x - o[0]) + ny * (y - o[1])) / nz);
}
