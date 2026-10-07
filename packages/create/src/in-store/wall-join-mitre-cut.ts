/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The mitred `L` corner of `computeWallJoin` (`style: 'mitre'`), on the
 * join's own frame helpers. See `wall-join.ts` for the join kinds.
 */

import {
  add, cross, cutAlong, joinedWall, LENGTH_EPS, outward, scale, sideOf, sub,
  type Frame, type PlanPoint, type WallJoin, type WallJoinOptions, type WallJoinSide,
} from './wall-join.js';

/** Where the line `p + t·u` crosses the line `q + r·v` (the two are not parallel here). */
function crossing(p: PlanPoint, u: PlanPoint, q: PlanPoint, v: PlanPoint): PlanPoint {
  const t = cross(sub(q, p), v) / cross(u, v);
  return add(p, scale(u, t));
}

/**
 * A mitred `L`: each face of one wall meets the matching face of the other
 * (inner with inner, outer with outer); both bodies are cut on the line
 * through those two corners. The relating wall is the priority one (default
 * the thicker), though neither runs through.
 */
export function mitreJoin(
  fa: Frame, fb: Frame, endA: 'ATSTART' | 'ATEND', endB: 'ATSTART' | 'ATEND', point: PlanPoint, options: WallJoinOptions,
): WallJoin {
  // A face of `f` on the side `other` comes in from is its inner face (toward the corner's inside).
  const faceLine = (f: Frame, y: number): [PlanPoint, PlanPoint] => [add(point, scale(f.normal, y)), f.dir];
  const innerY = (f: Frame, other: Frame, otherEnd: 'ATSTART' | 'ATEND') => (sideOf(f, scale(outward(other, otherEnd), -1)) > 0 ? f.yMax : f.yMin);
  const outerY = (f: Frame, other: Frame, otherEnd: 'ATSTART' | 'ATEND') => (sideOf(f, scale(outward(other, otherEnd), -1)) > 0 ? f.yMin : f.yMax);
  const [ia, ua] = faceLine(fa, innerY(fa, fb, endB));
  const [ib, ub] = faceLine(fb, innerY(fb, fa, endA));
  const [oa, va] = faceLine(fa, outerY(fa, fb, endB));
  const [ob, vb] = faceLine(fb, outerY(fb, fa, endA));
  const inner = crossing(ia, ua, ib, ub);
  const outer = crossing(oa, va, ob, vb);
  const diagonal = sub(outer, inner);
  if (Math.hypot(diagonal[0], diagonal[1]) <= LENGTH_EPS) throw new Error('computeWallJoin: the mitre has no length');
  const throughIsA = (options.priority ?? (fb.wall.thickness > fa.wall.thickness ? 'b' : 'a')) === 'a';
  const side = (f: Frame, end: 'ATSTART' | 'ATEND'): WallJoinSide => ({
    connection: end,
    runsThrough: false,
    wall: joinedWall(f, end, point, cutAlong(f, end, point, inner, diagonal)),
  });
  return { kind: 'L', style: 'mitre', point, relating: throughIsA ? 'a' : 'b', a: side(fa, endA), b: side(fb, endB) };
}
