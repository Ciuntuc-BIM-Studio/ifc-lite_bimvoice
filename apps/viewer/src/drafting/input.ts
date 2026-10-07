/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Typed coordinate input and cursor constraints (ortho / polar tracking).
 *
 * Accepted forms (spaces allowed around separators, "." decimals, signs):
 *   "x,y"      absolute point
 *   "@dx,dy"   relative to the last point
 *   "@d<deg"   relative polar (degrees, CCW from +x)
 *   "d<deg"    absolute polar from the origin
 *   "@"        the last point itself
 *   "d"        a bare distance (the caller applies it along the cursor direction)
 */

import type { Pt } from './types';
import { add, len, sub, EPS } from './vec';

export type CoordinateInput = { kind: 'point'; pt: Pt } | { kind: 'distance'; d: number };

const NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function num(s: string): number | null {
  const t = s.trim();
  if (!NUMBER_RE.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function polarVec(d: number, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  return { x: d * Math.cos(a), y: d * Math.sin(a) };
}

export function parseCoordinateInput(text: string, ctx: { last: Pt | null }): CoordinateInput | null {
  let body = text.trim();
  if (body.length === 0) return null;
  const relative = body.startsWith('@');
  if (relative) {
    if (!ctx.last) return null;
    body = body.slice(1).trim();
    if (body.length === 0) return { kind: 'point', pt: { ...ctx.last } };
  }
  const base: Pt = relative && ctx.last ? ctx.last : { x: 0, y: 0 };

  const lt = body.split('<');
  if (lt.length === 2) {
    const d = num(lt[0]);
    const deg = num(lt[1]);
    if (d === null || deg === null) return null;
    return { kind: 'point', pt: add(base, polarVec(d, deg)) };
  }
  if (lt.length > 2) return null;

  const parts = body.split(',');
  if (parts.length === 2) {
    const x = num(parts[0]);
    const y = num(parts[1]);
    if (x === null || y === null) return null;
    return { kind: 'point', pt: add(base, { x, y }) };
  }
  if (parts.length > 2 || relative) return null;

  const d = num(body);
  return d === null ? null : { kind: 'distance', d };
}

/** Constrain `to` to the horizontal or vertical through `from`, whichever dominates. */
export function applyOrtho(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** Round the direction from→to to a multiple of `incrementDeg`, keeping the distance. */
export function applyPolar(from: Pt, to: Pt, incrementDeg: number): Pt {
  const v = sub(to, from);
  const d = len(v);
  if (d < EPS || !(incrementDeg > 0)) return { ...to };
  const inc = (incrementDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(v.y, v.x) / inc) * inc;
  return { x: from.x + d * Math.cos(a), y: from.y + d * Math.sin(a) };
}

/** Point at distance `d` from `from` toward `toward` (+x when they coincide). */
export function pointAlong(from: Pt, toward: Pt, d: number): Pt {
  const v = sub(toward, from);
  const l = len(v);
  if (l < EPS) return { x: from.x + d, y: from.y };
  return { x: from.x + (v.x / l) * d, y: from.y + (v.y / l) * d };
}
