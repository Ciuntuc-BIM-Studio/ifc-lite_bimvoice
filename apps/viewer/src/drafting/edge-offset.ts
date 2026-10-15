/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Pushing one side of an outline square to itself, and cutting a side in
 * two — the edits a slab's outline and a drafted polygon share.
 *
 * `offsetEdge` moves side `i` (from vertex i to the next) along its normal.
 * Each of its ends slides along the side before / after it, so those keep
 * their direction and only grow or shrink. Where that neighbour runs on the
 * same line (the side was cut there with the knife), the end stays where it
 * is and a step square to the side is added instead: only that piece of the
 * original side moves out.
 *
 * `knifeAt` cuts the side nearest a point there, adding a vertex.
 */

import type { Pt } from './types';

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const len = (a: Pt) => Math.hypot(a.x, a.y);

/** The unit normal of side i, to its left (from vertex i toward the next), and its middle. */
export function edgeFrame(pts: readonly Pt[], i: number): { mid: Pt; normal: Pt } {
  const a = pts[i], b = pts[(i + 1) % pts.length];
  const d = sub(b, a), l = len(d) || 1;
  return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal: { x: -d.y / l, y: d.x / l } };
}

/** How far side i moves for a drag to `p`: the drag's component along the side's normal. */
export function edgeOffsetFor(pts: readonly Pt[], i: number, p: Pt): number {
  const { mid, normal } = edgeFrame(pts, i);
  return (p.x - mid.x) * normal.x + (p.y - mid.y) * normal.y;
}

/** Where the line through `p` along `u` meets the line through `q` along `v`, or null when they are parallel. */
function meet(p: Pt, u: Pt, q: Pt, v: Pt): Pt | null {
  const den = cross(u, v);
  if (Math.abs(den) < 1e-12 * Math.max(len(u) * len(v), 1e-12)) return null;
  const t = cross(sub(q, p), v) / den;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/** Whether u and v run along one line (within about 0.01°). */
const parallel = (u: Pt, v: Pt) => Math.abs(cross(u, v)) <= 2e-4 * len(u) * len(v);

/** The outline with side i moved `d` along its normal (`closed`: the last vertex joins the first). */
export function offsetEdge(pts: readonly Pt[], i: number, d: number, closed: boolean): Pt[] {
  const n = pts.length;
  if (n < 2 || Math.abs(d) < 1e-12) return [...pts];
  const j = (i + 1) % n;
  const a = pts[i], b = pts[j];
  const { normal } = edgeFrame(pts, i);
  const shift = (p: Pt): Pt => ({ x: p.x + normal.x * d, y: p.y + normal.y * d });
  const along = sub(b, a);
  const prev = closed ? pts[(i - 1 + n) % n] : i > 0 ? pts[i - 1] : null;
  const next = closed ? pts[(j + 1) % n] : j < n - 1 ? pts[j + 1] : null;
  // Each end: slid along its neighbour, or — the neighbour on the same line, or none — moved square with a step.
  const startSide = prev ? sub(a, prev) : null;
  const endSide = next ? sub(next, b) : null;
  const slidA = startSide && !parallel(startSide, along) ? meet(prev!, startSide, shift(a), along) : null;
  const slidB = endSide && !parallel(endSide, along) ? meet(b, endSide, shift(a), along) : null;
  const startPts = slidA ? [slidA] : prev ? [a, shift(a)] : [shift(a)];
  const endPts = slidB ? [slidB] : next ? [shift(b), b] : [shift(b)];
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    if (k === i) out.push(...startPts);
    else if (k === j) out.push(...endPts);
    else out.push(pts[k]);
  }
  // A step that closes up again (both ends back on a line) leaves no zero-length side.
  return out.filter((p, k) => {
    const q = out[(k - 1 + out.length) % out.length];
    return k === 0 && !closed ? true : Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
  });
}

/** The side of an outline nearest `p` and the point on it, or null past `tolerance`. */
export function nearestEdge(pts: readonly Pt[], p: Pt, closed: boolean, tolerance = Infinity): { index: number; at: Pt; distance: number } | null {
  let best: { index: number; at: Pt; distance: number } | null = null;
  const sides = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < sides; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const d = sub(b, a), l2 = d.x * d.x + d.y * d.y;
    const t = l2 > 0 ? Math.min(Math.max(((p.x - a.x) * d.x + (p.y - a.y) * d.y) / l2, 0), 1) : 0;
    const at = { x: a.x + d.x * t, y: a.y + d.y * t };
    const distance = Math.hypot(p.x - at.x, p.y - at.y);
    if (distance <= tolerance && (!best || distance < best.distance)) best = { index: i, at, distance };
  }
  return best;
}

/** The outline cut at the point of its side nearest `p` (a vertex there), or null when that point is a vertex already. */
export function knifeAt(pts: readonly Pt[], p: Pt, closed: boolean, tolerance = Infinity): Pt[] | null {
  const hit = nearestEdge(pts, p, closed, tolerance);
  if (!hit) return null;
  const a = pts[hit.index], b = pts[(hit.index + 1) % pts.length];
  const near = Math.max(Math.hypot(b.x - a.x, b.y - a.y) * 1e-6, 1e-9);
  if (Math.hypot(hit.at.x - a.x, hit.at.y - a.y) < near || Math.hypot(hit.at.x - b.x, hit.at.y - b.y) < near) return null;
  return [...pts.slice(0, hit.index + 1), hit.at, ...pts.slice(hit.index + 1)];
}
