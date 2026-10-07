/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 2D vector helpers for the drafting kernel. Points and vectors share the
 * `Pt` shape; every helper is pure and allocates a fresh result.
 */

import type { Pt } from './types';

/** Numerical tolerance for math comparisons. */
export const EPS = 1e-9;
/** Points closer than this (metres) are treated as coincident. */
export const COINCIDENT = 1e-6;
export const TAU = Math.PI * 2;

export function pt(x: number, y: number): Pt {
  return { x, y };
}

export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Pt, b: Pt): Pt {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

export function dot(a: Pt, b: Pt): number {
  return a.x * b.x + a.y * b.y;
}

/** z-component of the 3D cross product (positive when b is CCW of a). */
export function cross(a: Pt, b: Pt): number {
  return a.x * b.y - a.y * b.x;
}

export function len(a: Pt): number {
  return Math.hypot(a.x, a.y);
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Unit vector; returns (0,0) for a zero-length input. */
export function norm(a: Pt): Pt {
  const l = len(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left-hand perpendicular (rotated +90°). */
export function perp(a: Pt): Pt {
  return { x: -a.y, y: a.x };
}

export function rotatePt(p: Pt, center: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

/** Reflect `p` across the infinite line through `a` and `b`. */
export function mirrorPt(p: Pt, a: Pt, b: Pt): Pt {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS * EPS) {
    // Degenerate axis: reflect through the point `a`.
    return { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
  }
  const t = dot(sub(p, a), d) / l2;
  const foot = add(a, scale(d, t));
  return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function angleOf(v: Pt): number {
  return Math.atan2(v.y, v.x);
}

/** Normalise an angle into [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TAU;
  const n = r < 0 ? r + TAU : r;
  return n >= TAU ? 0 : n;
}

/** CCW sweep from `start` to `end`, in (0, 2π]. Equal angles mean a full turn. */
export function sweepOf(start: number, end: number): number {
  const s = normAngle(end - start);
  return s < EPS ? TAU : s;
}

/** True when `angle` lies on the CCW sweep from `start` to `end` (inclusive). */
export function angleInArc(angle: number, start: number, end: number, tol = EPS): boolean {
  const sw = sweepOf(start, end);
  const off = normAngle(angle - start);
  if (off <= sw + tol) return true;
  // Wrap-around tolerance just before `start`.
  return TAU - off <= tol;
}

/** Point on a circle at a given angle. */
export function polar(c: Pt, r: number, a: number): Pt {
  return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
}

export function samePt(a: Pt, b: Pt, tol = COINCIDENT): boolean {
  return dist(a, b) <= tol;
}
