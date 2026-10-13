/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hatch boundary detection for "pick a point inside": given closed loops,
 * find the smallest loop containing the point (outer boundary) and every
 * loop nested inside it — its islands (holes), the islands inside those, and
 * so on — first-level islands first. Filled even-odd, that is AutoCAD's
 * "normal" island style: outer filled, holes empty, islands in holes filled.
 *
 * The same outline often comes twice (a closed polyline and the area its own
 * segments enclose); a loop drawn twice would cancel itself under even-odd,
 * so duplicates are dropped first.
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

/** Two loops trace the same outline: same area and extent, every vertex of one on the other. */
function sameLoop(a: LoopInfo, b: LoopInfo): boolean {
  const span = Math.max(a.maxX - a.minX, a.maxY - a.minY, 1e-9);
  const tol = span * 1e-6;
  if (Math.abs(a.area - b.area) > span * span * 1e-6) return false;
  if (Math.abs(a.minX - b.minX) > tol || Math.abs(a.minY - b.minY) > tol || Math.abs(a.maxX - b.maxX) > tol || Math.abs(a.maxY - b.maxY) > tol) return false;
  return a.pts.every((v) => onBoundary(v, b, tol)) && b.pts.every((v) => onBoundary(v, a, tol));
}

/**
 * Region around `p`: `[outer, ...islands]` (first-level islands first, then
 * the ones nested in them), or null when no loop contains p. Degenerate loops
 * (< 3 points or ~zero area) and repeated outlines are ignored.
 */
export function regionAt(p: Pt, loops: readonly Pt[][]): Pt[][] | null {
  const valid: LoopInfo[] = [];
  for (const l of loops) {
    if (l.length < 3) continue;
    const li = info(l);
    const span = Math.max(li.maxX - li.minX, li.maxY - li.minY);
    if (!(li.area > span * span * 1e-12)) continue;
    if (valid.some((v) => sameLoop(v, li))) continue;
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
  const nested = candidates.filter((l) => !holes.includes(l));
  return [chosenOuter.pts, ...holes.map((h) => h.pts), ...nested.map((h) => h.pts)];
}
