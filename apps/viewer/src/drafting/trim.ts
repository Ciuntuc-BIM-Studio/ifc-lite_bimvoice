/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Trim: split a shape at its crossings with cutter shapes and drop the piece
 * under the pick point.
 *
 * Each shape is mapped to a 1D parameter: a line uses t ∈ [0,1], a polyline
 * uses segmentIndex + t, an arc uses the CCW angle offset from its start and
 * a circle its normalised angle. Circles and closed polylines are periodic.
 */

import type { DraftShape, Pt } from './types';
import { nearestOnSeg, nearestOnShape, shapePrims } from './curves';
import { intersectPrims, pushUnique } from './intersect';
import { angleOf, dist, lerp, normAngle, polar, sub, sweepOf, COINCIDENT, TAU } from './vec';

export { extendShape } from './extend';

interface Param {
  /** Parameter range is [0, length] (periodic shapes wrap at `length`). */
  length: number;
  periodic: boolean;
  paramOf(p: Pt): number;
  pointAt(s: number): Pt;
  /** Piece between s0 and s1 (s1 may exceed `length` for periodic shapes). */
  piece(s0: number, s1: number): DraftShape | null;
}

function polylineParam(pts: readonly Pt[], closed: boolean, asLine: boolean): Param {
  const n = pts.length;
  const segCount = closed ? n : n - 1;
  const vtx = (k: number): Pt => pts[((k % n) + n) % n];
  const pointAt = (s: number): Pt => {
    const w = closed ? ((s % segCount) + segCount) % segCount : Math.max(0, Math.min(segCount, s));
    const i = Math.min(Math.floor(w), segCount - 1);
    return lerp(vtx(i), vtx(i + 1), w - i);
  };
  return {
    length: segCount,
    periodic: closed,
    pointAt,
    paramOf(p) {
      let best = Infinity;
      let s = 0;
      for (let i = 0; i < segCount; i++) {
        const h = nearestOnSeg(vtx(i), vtx(i + 1), p);
        const d = dist(h.point, p);
        if (d < best) {
          best = d;
          s = i + h.t;
        }
      }
      return closed && s >= segCount ? s - segCount : s;
    },
    piece(s0, s1) {
      const out: Pt[] = [pointAt(s0)];
      for (let k = Math.floor(s0) + 1; k < s1; k++) pushUnique(out, vtx(k));
      pushUnique(out, pointAt(s1));
      if (out.length < 2) return null;
      if (asLine) return { type: 'line', a: out[0], b: out[out.length - 1] };
      return { type: 'polyline', pts: out, closed: false };
    },
  };
}

function shapeParam(shape: DraftShape): Param | null {
  switch (shape.type) {
    case 'line':
      return polylineParam([shape.a, shape.b], false, true);
    case 'polyline':
      if (shape.pts.length < 2) return null;
      return polylineParam(shape.pts, shape.closed && shape.pts.length > 2, false);
    case 'circle': {
      const { c, r } = shape;
      return {
        length: TAU,
        periodic: true,
        paramOf: (p) => normAngle(angleOf(sub(p, c))),
        pointAt: (s) => polar(c, r, s),
        piece: (s0, s1) => ({ type: 'arc', c, r, start: normAngle(s0), end: normAngle(s1) }),
      };
    }
    case 'arc': {
      const { c, r } = shape;
      const start = normAngle(shape.start);
      const sw = sweepOf(shape.start, shape.end);
      return {
        length: sw,
        periodic: false,
        paramOf(p) {
          const u = normAngle(angleOf(sub(p, c)) - start);
          if (u <= sw) return u;
          // Outside the sweep: snap to the nearer end (cyclically).
          return TAU - u < u - sw ? 0 : sw;
        },
        pointAt: (s) => polar(c, r, start + s),
        piece: (s0, s1) => ({ type: 'arc', c, r, start: normAngle(start + s0), end: normAngle(start + s1) }),
      };
    }
  }
}

/** Cut points of `shape` against `cutters` (the shape itself is skipped). */
export function cutPoints(shape: DraftShape, cutters: readonly DraftShape[]): Pt[] {
  const pts: Pt[] = [];
  const own = shapePrims(shape);
  for (const cutter of cutters) {
    if (cutter === shape) continue;
    const other = shapePrims(cutter);
    for (const p of own) for (const q of other) for (const x of intersectPrims(p, q)) pushUnique(pts, x);
  }
  return pts;
}

export function trimShape(shape: DraftShape, cutters: DraftShape[], pick: Pt): DraftShape[] | null {
  const param = shapeParam(shape);
  if (!param) return null;
  const pts = cutPoints(shape, cutters);
  if (pts.length === 0) return null;
  const pickS = param.paramOf(nearestOnShape(shape, pick).point);

  if (!param.periodic) {
    const start = param.pointAt(0);
    const end = param.pointAt(param.length);
    const cuts = pts
      .filter((p) => dist(p, start) > COINCIDENT && dist(p, end) > COINCIDENT)
      .map((p) => param.paramOf(p))
      .sort((a, b) => a - b);
    if (cuts.length === 0) return null;
    const bounds = [0, ...cuts, param.length];
    const out: DraftShape[] = [];
    let removed = false;
    for (let i = 0; i + 1 < bounds.length; i++) {
      const s0 = bounds[i];
      const s1 = bounds[i + 1];
      if (!removed && pickS >= s0 && pickS <= s1) {
        removed = true;
        continue;
      }
      const piece = param.piece(s0, s1);
      if (piece) out.push(piece);
    }
    return out;
  }

  const cuts = pts.map((p) => param.paramOf(p)).sort((a, b) => a - b);
  if (cuts.length < 2) return null;
  // Find the cyclic interval [cuts[j], cuts[j+1]] that holds the pick.
  const L = param.length;
  let j = cuts.length - 1; // default: the wrap-around interval
  for (let i = 0; i + 1 < cuts.length; i++) {
    if (pickS >= cuts[i] && pickS <= cuts[i + 1]) {
      j = i;
      break;
    }
  }
  const keepStart = cuts[(j + 1) % cuts.length];
  let keepEnd = cuts[j];
  if (keepEnd <= keepStart) keepEnd += L;
  const piece = param.piece(keepStart, keepEnd);
  return piece ? [piece] : [];
}
