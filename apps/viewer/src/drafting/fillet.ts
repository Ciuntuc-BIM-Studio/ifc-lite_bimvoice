/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fillet and chamfer between two lines.
 *
 * Both lines are treated as infinite to find their corner X. For each line
 * the picked side defines a unit direction u (from X toward the pick); the
 * line keeps its endpoint furthest along u and has its other end moved to
 * the tangent / chamfer point on that ray.
 */

import type { DraftShape, Pt } from './types';
import { add, angleOf, cross, dist, dot, norm, scale, sub, sweepOf, EPS } from './vec';

export type LineShape = Extract<DraftShape, { type: 'line' }>;

interface Leg {
  u: Pt;
  /** Distance from X to the kept far endpoint along u. */
  reach: number;
  keepB: boolean;
  line: LineShape;
}

function corner(l1: LineShape, l2: LineShape): Pt | null {
  const d1 = sub(l1.b, l1.a);
  const d2 = sub(l2.b, l2.a);
  const den = cross(d1, d2);
  if (Math.abs(den) <= EPS * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) return null;
  const t = cross(sub(l2.a, l1.a), d2) / den;
  return add(l1.a, scale(d1, t));
}

function leg(line: LineShape, pick: Pt, x: Pt): Leg | null {
  const d = norm(sub(line.b, line.a));
  if (d.x === 0 && d.y === 0) return null;
  let s = dot(sub(pick, x), d);
  if (Math.abs(s) < EPS) {
    // Pick sits on the corner: fall back to the endpoint farther from X.
    s = dist(line.b, x) >= dist(line.a, x) ? dot(sub(line.b, x), d) : dot(sub(line.a, x), d);
  }
  const u = s >= 0 ? d : scale(d, -1);
  const pa = dot(sub(line.a, x), u);
  const pb = dot(sub(line.b, x), u);
  const keepB = pb >= pa;
  return { u, reach: Math.max(pa, pb), keepB, line };
}

function rebuild(l: Leg, p: Pt): LineShape {
  return l.keepB ? { type: 'line', a: p, b: l.line.b } : { type: 'line', a: l.line.a, b: p };
}

export function filletLines(
  l1: LineShape,
  pick1: Pt,
  l2: LineShape,
  pick2: Pt,
  radius: number,
): { first: DraftShape; second: DraftShape; arc: DraftShape | null } | null {
  const x = corner(l1, l2);
  if (!x || radius < 0) return null;
  const g1 = leg(l1, pick1, x);
  const g2 = leg(l2, pick2, x);
  if (!g1 || !g2) return null;
  if (radius < EPS) return { first: rebuild(g1, x), second: rebuild(g2, x), arc: null };

  const cosT = Math.max(-1, Math.min(1, dot(g1.u, g2.u)));
  const theta = Math.acos(cosT);
  if (theta < EPS || Math.PI - theta < EPS) return null;
  const half = theta / 2;
  const tDist = radius / Math.tan(half);
  if (tDist > g1.reach + 1e-6 || tDist > g2.reach + 1e-6) return null;
  const t1 = add(x, scale(g1.u, tDist));
  const t2 = add(x, scale(g2.u, tDist));
  const c = add(x, scale(norm(add(g1.u, g2.u)), radius / Math.sin(half)));
  const a1 = angleOf(sub(t1, c));
  const a2 = angleOf(sub(t2, c));
  const [start, end] = sweepOf(a1, a2) <= Math.PI ? [a1, a2] : [a2, a1];
  return {
    first: rebuild(g1, t1),
    second: rebuild(g2, t2),
    arc: { type: 'arc', c, r: radius, start, end },
  };
}

/**
 * Chamfer: cut the corner `d1` along the first line and `d2` along the
 * second. Both zero → plain corner (connecting line null).
 */
export function chamferLines(
  l1: LineShape,
  pick1: Pt,
  l2: LineShape,
  pick2: Pt,
  d1: number,
  d2: number,
): { first: DraftShape; second: DraftShape; line: DraftShape | null } | null {
  const x = corner(l1, l2);
  if (!x || d1 < 0 || d2 < 0) return null;
  const g1 = leg(l1, pick1, x);
  const g2 = leg(l2, pick2, x);
  if (!g1 || !g2) return null;
  if (d1 > g1.reach + 1e-6 || d2 > g2.reach + 1e-6) return null;
  const p1 = add(x, scale(g1.u, d1));
  const p2 = add(x, scale(g2.u, d2));
  const line: DraftShape | null = d1 < EPS && d2 < EPS ? null : { type: 'line', a: p1, b: p2 };
  return { first: rebuild(g1, p1), second: rebuild(g2, p2), line };
}
