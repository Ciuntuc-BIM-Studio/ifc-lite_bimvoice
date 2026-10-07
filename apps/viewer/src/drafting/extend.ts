/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Extend: lengthen the end of an open shape nearest the pick point until it
 * meets the nearest boundary. Lines and open polylines extend straight along
 * their end segment; arcs extend along their circle. Closed shapes and
 * circles cannot be extended.
 */

import type { DraftShape, Pt } from './types';
import { shapePrims, type ArcPrim } from './curves';
import { intersectPrims, intersectRayWithShape } from './intersect';
import { angleOf, dist, normAngle, polar, sub, sweepOf, COINCIDENT, TAU } from './vec';

/** Nearest boundary hit strictly beyond `origin` along `dir` (unit-free). */
function rayHit(origin: Pt, dir: Pt, shape: DraftShape, boundaries: readonly DraftShape[]): Pt | null {
  let best: Pt | null = null;
  let bestD = Infinity;
  for (const b of boundaries) {
    if (b === shape) continue;
    for (const h of intersectRayWithShape(origin, dir, b)) {
      const d = dist(h.point, origin);
      if (d > COINCIDENT && d < bestD) {
        bestD = d;
        best = h.point;
      }
    }
  }
  return best;
}

function extendArc(
  shape: Extract<DraftShape, { type: 'arc' }>,
  boundaries: readonly DraftShape[],
  pick: Pt,
): DraftShape | null {
  const start = normAngle(shape.start);
  const end = normAngle(shape.end);
  const gap = TAU - sweepOf(start, end);
  const atEnd = dist(pick, polar(shape.c, shape.r, end)) < dist(pick, polar(shape.c, shape.r, start));
  const circle: ArcPrim = { kind: 'arc', c: shape.c, r: shape.r, start: 0, end: 0, full: true };
  const tol = COINCIDENT / Math.max(shape.r, COINCIDENT);
  let bestDelta = Infinity;
  for (const b of boundaries) {
    if (b === shape) continue;
    for (const q of shapePrims(b)) {
      for (const x of intersectPrims(circle, q)) {
        const a = angleOf(sub(x, shape.c));
        const delta = atEnd ? normAngle(a - end) : normAngle(start - a);
        if (delta > tol && delta < gap - tol && delta < bestDelta) bestDelta = delta;
      }
    }
  }
  if (!Number.isFinite(bestDelta)) return null;
  return atEnd
    ? { type: 'arc', c: shape.c, r: shape.r, start, end: normAngle(end + bestDelta) }
    : { type: 'arc', c: shape.c, r: shape.r, start: normAngle(start - bestDelta), end };
}

export function extendShape(shape: DraftShape, boundaries: DraftShape[], pick: Pt): DraftShape | null {
  switch (shape.type) {
    case 'line': {
      const atA = dist(pick, shape.a) <= dist(pick, shape.b);
      const from = atA ? shape.a : shape.b;
      const other = atA ? shape.b : shape.a;
      const hit = rayHit(from, sub(from, other), shape, boundaries);
      if (!hit) return null;
      return atA ? { type: 'line', a: hit, b: shape.b } : { type: 'line', a: shape.a, b: hit };
    }
    case 'polyline': {
      const n = shape.pts.length;
      if (shape.closed || n < 2) return null;
      const atFirst = dist(pick, shape.pts[0]) <= dist(pick, shape.pts[n - 1]);
      const from = atFirst ? shape.pts[0] : shape.pts[n - 1];
      const other = atFirst ? shape.pts[1] : shape.pts[n - 2];
      const hit = rayHit(from, sub(from, other), shape, boundaries);
      if (!hit) return null;
      const pts = shape.pts.slice();
      pts[atFirst ? 0 : n - 1] = hit;
      return { type: 'polyline', pts, closed: false };
    }
    case 'arc':
      return extendArc(shape, boundaries, pick);
    case 'circle':
      return null;
  }
}
