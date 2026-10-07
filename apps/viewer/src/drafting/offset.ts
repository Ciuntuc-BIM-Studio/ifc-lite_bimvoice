/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Offset (parallel copy) of drafting shapes toward the side of a picked
 * point. Polylines are offset segment-by-segment and re-joined with miter
 * joins at the intersection of consecutive offset lines.
 */

import type { DraftShape, Pt } from './types';
import { nearestOnSeg } from './curves';
import { add, cross, dist, norm, perp, scale, sub, COINCIDENT, EPS } from './vec';

/** Even-odd ray-casting point-in-polygon test (boundary behaviour unspecified). */
export function pointInPolygon(p: Pt, pts: readonly Pt[]): boolean {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

/** Signed area (positive for CCW). */
export function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) s += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  return s / 2;
}

/** Side of `p` relative to directed a→b: +1 left, -1 right (0 treated as left). */
function sideOf(a: Pt, b: Pt, p: Pt): number {
  return cross(sub(b, a), sub(p, a)) < 0 ? -1 : 1;
}

function cleanPts(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (out.length === 0 || dist(out[out.length - 1], p) > COINCIDENT) out.push(p);
  if (closed && out.length > 1 && dist(out[0], out[out.length - 1]) <= COINCIDENT) out.pop();
  return out;
}

interface OffSeg {
  a: Pt;
  b: Pt;
  dir: Pt;
}

/** Intersection of two infinite lines, or null when parallel. */
function lineLine(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(q, p), e) / den;
  return add(p, scale(d, t));
}

/** Join point(s) between consecutive offset segments s1 → s2. */
function joinPts(s1: OffSeg, s2: OffSeg): Pt[] {
  const x = lineLine(s1.a, s1.dir, s2.a, s2.dir);
  if (x) return [x];
  // Parallel: collinear continuation shares the point; reversal just connects.
  if (dist(s1.b, s2.a) <= COINCIDENT) return [s1.b];
  return [s1.b, s2.a];
}

function offsetPolyline(pts: readonly Pt[], closed: boolean, d: number, sidePoint: Pt): DraftShape | null {
  const p = cleanPts(pts, closed);
  if (p.length < 2 || (closed && p.length < 3)) return null;
  const n = p.length;
  const segCount = closed ? n : n - 1;
  let sign: number;
  if (closed) {
    const ccw = signedArea(p) > 0;
    const inside = pointInPolygon(sidePoint, p);
    sign = inside === ccw ? 1 : -1;
  } else {
    let best = Infinity;
    sign = 1;
    for (let i = 0; i < segCount; i++) {
      const a = p[i];
      const b = p[i + 1];
      const h = dist(nearestOnSeg(a, b, sidePoint).point, sidePoint);
      if (h < best) {
        best = h;
        sign = sideOf(a, b, sidePoint);
      }
    }
  }
  const segs: OffSeg[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const dir = norm(sub(b, a));
    const off = scale(perp(dir), d * sign);
    segs.push({ a: add(a, off), b: add(b, off), dir });
  }
  const out: Pt[] = [];
  if (closed) {
    for (let i = 0; i < segCount; i++) out.push(...joinPts(segs[(i - 1 + segCount) % segCount], segs[i]));
  } else {
    out.push(segs[0].a);
    for (let i = 1; i < segCount; i++) out.push(...joinPts(segs[i - 1], segs[i]));
    out.push(segs[segCount - 1].b);
  }
  return { type: 'polyline', pts: out, closed };
}

/**
 * Offset `shape` by |distance| toward the side containing `sidePoint`.
 * Returns null when the result would degenerate (radius ≤ 0, too few points).
 */
export function offsetShape(shape: DraftShape, distance: number, sidePoint: Pt): DraftShape | null {
  const d = Math.abs(distance);
  if (d < EPS) return null;
  switch (shape.type) {
    case 'line': {
      const dir = norm(sub(shape.b, shape.a));
      if (dir.x === 0 && dir.y === 0) return null;
      const off = scale(perp(dir), d * sideOf(shape.a, shape.b, sidePoint));
      return { type: 'line', a: add(shape.a, off), b: add(shape.b, off) };
    }
    case 'circle':
    case 'arc': {
      const inward = dist(sidePoint, shape.c) < shape.r;
      const r = inward ? shape.r - d : shape.r + d;
      if (r <= COINCIDENT) return null;
      return shape.type === 'circle' ? { type: 'circle', c: shape.c, r } : { ...shape, r };
    }
    case 'polyline':
      return offsetPolyline(shape.pts, shape.closed, d, sidePoint);
  }
}
