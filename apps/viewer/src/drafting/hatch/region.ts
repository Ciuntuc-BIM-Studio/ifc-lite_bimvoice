/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hatch boundary detection for "pick a point inside": given closed loops,
 * find the smallest loop containing the point (outer boundary) and the
 * first-level islands inside it (holes).
 */

import type { Pt } from '../types';
import { pointInPolygon, signedArea } from '../offset';

/** Absolute area of a closed loop (any winding). */
export function loopArea(pts: readonly Pt[]): number {
  return Math.abs(signedArea(pts));
}

interface LoopInfo {
  pts: Pt[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function info(pts: Pt[]): LoopInfo {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { pts, area: loopArea(pts), minX, minY, maxX, maxY };
}

/** Squared distance from p to segment ab. */
function distSqToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

function onBoundary(p: Pt, loop: LoopInfo, tol: number): boolean {
  const pts = loop.pts;
  const tol2 = tol * tol;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if (distSqToSeg(p, pts[j], pts[i]) <= tol2) return true;
  }
  return false;
}

/**
 * True when `inner` lies inside `outer`: no vertex of `inner` is strictly
 * outside, at least one is strictly inside (vertices touching the boundary
 * are ignored). When every vertex touches, the vertex centroid decides.
 */
function loopInside(inner: LoopInfo, outer: LoopInfo): boolean {
  if (inner.area >= outer.area) return false;
  if (inner.minX < outer.minX - 1e-9 || inner.maxX > outer.maxX + 1e-9) return false;
  if (inner.minY < outer.minY - 1e-9 || inner.maxY > outer.maxY + 1e-9) return false;
  const span = Math.max(outer.maxX - outer.minX, outer.maxY - outer.minY);
  const tol = Math.max(span * 1e-9, 1e-12);
  let anyInside = false;
  let cx = 0;
  let cy = 0;
  for (const v of inner.pts) {
    cx += v.x;
    cy += v.y;
    if (onBoundary(v, outer, tol)) continue;
    if (!pointInPolygon(v, outer.pts)) return false;
    anyInside = true;
  }
  if (anyInside) return true;
  const c = { x: cx / inner.pts.length, y: cy / inner.pts.length };
  return pointInPolygon(c, outer.pts);
}

/**
 * Region around `p`: `[outer, ...holes]`, or null when no loop contains p.
 * Degenerate loops (< 3 points or ~zero area) are ignored.
 */
export function regionAt(p: Pt, loops: readonly Pt[][]): Pt[][] | null {
  const valid: LoopInfo[] = [];
  for (const l of loops) {
    if (l.length < 3) continue;
    const li = info(l);
    const span = Math.max(li.maxX - li.minX, li.maxY - li.minY);
    if (!(li.area > span * span * 1e-12)) continue;
    valid.push(li);
  }
  let outer: LoopInfo | null = null;
  for (const l of valid) {
    if (p.x < l.minX || p.x > l.maxX || p.y < l.minY || p.y > l.maxY) continue;
    if (!pointInPolygon(p, l.pts)) continue;
    if (!outer || l.area < outer.area) outer = l;
  }
  if (!outer) return null;
  const chosenOuter = outer;
  const candidates = valid.filter(
    (l) => l !== chosenOuter && !pointInPolygon(p, l.pts) && loopInside(l, chosenOuter),
  );
  const holes = candidates.filter((l) => !candidates.some((o) => o !== l && loopInside(l, o)));
  return [chosenOuter.pts, ...holes.map((h) => h.pts)];
}
