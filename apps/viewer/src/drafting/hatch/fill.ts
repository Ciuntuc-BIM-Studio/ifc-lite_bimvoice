/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Hatch geometry generation: clip each line family of a pattern against a
 * region (EVEN-ODD over all loops, so islands are holes and nested islands
 * fill again) and apply its dash sequence.
 *
 * Per family, every loop edge is projected once into the family frame
 * (h = offset along the left normal n, t = position along the direction d).
 * Line k sits at h = k·deltaY; an edge crosses it under the half-open rule
 * min(h) ≤ h_k < max(h), so a vertex lying exactly on a line is counted once
 * (or zero / twice for a touching vertex) and the even-odd parity never
 * flips. Edges are swept in h order with an active list.
 */

import type { Pt } from '../types';
import type { HatchLineFamily, HatchPattern } from './pattern';

/** One hatch stroke; a dot has `a` equal to `b`. */
export interface HatchSegment {
  a: Pt;
  b: Pt;
}

export interface HatchOptions {
  /** Multiplies all pattern lengths (origin, deltas, dashes). */
  scale: number;
  /** Rotation of the whole pattern in degrees (about `origin`). */
  angleDeg: number;
  /** Pattern origin in drawing units (default 0,0). */
  origin?: Pt;
  /** Output cap (default 200 000). */
  maxSegments?: number;
}

export interface HatchResult {
  segments: HatchSegment[];
  truncated: boolean;
}

const DEFAULT_MAX = 200000;
const DEG = Math.PI / 180;

/** Edge projected into a family frame. */
interface FEdge {
  h0: number;
  t0: number;
  h1: number;
  t1: number;
  hMin: number;
  hMax: number;
}

interface Emitter {
  out: HatchSegment[];
  max: number;
  truncated: boolean;
}

function projectEdges(loops: readonly Pt[][], bx: number, by: number, dx: number, dy: number): FEdge[] {
  const edges: FEdge[] = [];
  for (const loop of loops) {
    const n = loop.length;
    if (n < 2) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const p = loop[j];
      const q = loop[i];
      const px = p.x - bx;
      const py = p.y - by;
      const qx = q.x - bx;
      const qy = q.y - by;
      // n = (-dy, dx)
      const h0 = -px * dy + py * dx;
      const h1 = -qx * dy + qy * dx;
      if (h0 === h1) continue; // parallel to the family: never crosses (half-open)
      edges.push({
        h0,
        t0: px * dx + py * dy,
        h1,
        t1: qx * dx + qy * dy,
        hMin: Math.min(h0, h1),
        hMax: Math.max(h0, h1),
      });
    }
  }
  edges.sort((a, b) => a.hMin - b.hMin);
  return edges;
}

/**
 * Generate hatch strokes for `pattern` inside the even-odd region of `loops`.
 * Solid patterns yield no strokes (the renderer fills the region instead).
 */
export function hatchSegments(loops: readonly Pt[][], pattern: HatchPattern, opts: HatchOptions): HatchResult {
  const em: Emitter = { out: [], max: Math.max(0, opts.maxSegments ?? DEFAULT_MAX), truncated: false };
  if (pattern.solid || !(opts.scale > 0) || !Number.isFinite(opts.scale)) return { segments: em.out, truncated: false };
  const usable = loops.filter((l) => l.length >= 3);
  if (usable.length === 0) return { segments: em.out, truncated: false };
  for (const fam of pattern.families) {
    if (em.truncated) break;
    hatchFamily(usable, fam, opts, em);
  }
  return { segments: em.out, truncated: em.truncated };
}

function hatchFamily(loops: readonly Pt[][], fam: HatchLineFamily, opts: HatchOptions, em: Emitter): void {
  const s = opts.scale;
  const spacing = fam.deltaY * s;
  if (!(Math.abs(spacing) > 1e-12) || !Number.isFinite(spacing)) return;
  const shift = fam.deltaX * s;

  // Dashes (scaled). Skip families that would never draw anything.
  const dashes = fam.dashes.map((v) => v * s);
  let period = 0;
  let drawsSomething = dashes.length === 0;
  for (const v of dashes) {
    period += Math.abs(v);
    if (v >= 0) drawsSomething = true;
  }
  if (!drawsSomething) return;
  if (dashes.length > 0 && !(period > 1e-12)) return;

  const rot = opts.angleDeg * DEG;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const o = opts.origin ?? { x: 0, y: 0 };
  const fx = fam.origin.x * s;
  const fy = fam.origin.y * s;
  const bx = o.x + fx * cr - fy * sr;
  const by = o.y + fx * sr + fy * cr;
  const a = (fam.angleDeg + opts.angleDeg) * DEG;
  const dx = Math.cos(a);
  const dy = Math.sin(a);

  const edges = projectEdges(loops, bx, by, dx, dy);
  if (edges.length === 0) return;
  let hLo = Infinity;
  let hHi = -Infinity;
  for (const e of edges) {
    if (e.hMin < hLo) hLo = e.hMin;
    if (e.hMax > hHi) hHi = e.hMax;
  }
  // Iterate lines in increasing h regardless of the sign of deltaY.
  const step = Math.abs(spacing);
  const sign = spacing > 0 ? 1 : -1;
  const jFirst = Math.ceil(hLo / step);
  const jLast = Math.floor(hHi / step);
  if (jLast < jFirst) return;
  // Guard against absurd line counts (e.g. a tiny scale on a huge region).
  if (jLast - jFirst > em.max * 10 + 1000) {
    em.truncated = true;
    return;
  }

  const active: FEdge[] = [];
  const ts: number[] = [];
  let next = 0;
  for (let j = jFirst; j <= jLast; j++) {
    const h = j * step;
    const k = j * sign; // line index in the family
    const along = k * shift; // t of the line's own origin
    while (next < edges.length && edges[next].hMin <= h) active.push(edges[next++]);
    ts.length = 0;
    let w = 0;
    for (let r = 0; r < active.length; r++) {
      const e = active[r];
      if (e.hMax <= h) continue; // drop (half-open: hMin <= h < hMax)
      active[w++] = e;
      const u = (h - e.h0) / (e.h1 - e.h0);
      ts.push(e.t0 + u * (e.t1 - e.t0) - along);
    }
    active.length = w;
    if (ts.length < 2) continue;
    ts.sort((p, q) => p - q);
    // Line point for local parameter t: B + (t + along)·d + h·n.
    const lx = bx + along * dx - h * dy;
    const ly = by + along * dy + h * dx;
    for (let i = 0; i + 1 < ts.length; i += 2) {
      const t0 = ts[i];
      const t1 = ts[i + 1];
      if (!(t1 - t0 > 1e-12)) continue;
      if (dashes.length === 0) emit(em, lx, ly, dx, dy, t0, t1);
      else emitDashed(em, lx, ly, dx, dy, t0, t1, dashes, period);
      if (em.truncated) return;
    }
  }
}

function emit(em: Emitter, lx: number, ly: number, dx: number, dy: number, t0: number, t1: number): void {
  if (em.out.length >= em.max) {
    em.truncated = true;
    return;
  }
  em.out.push({ a: { x: lx + t0 * dx, y: ly + t0 * dy }, b: { x: lx + t1 * dx, y: ly + t1 * dy } });
}

function emitDashed(
  em: Emitter,
  lx: number,
  ly: number,
  dx: number,
  dy: number,
  t0: number,
  t1: number,
  dashes: readonly number[],
  period: number,
): void {
  let pos = Math.floor(t0 / period) * period;
  while (pos <= t1) {
    for (const v of dashes) {
      const len = Math.abs(v);
      if (v > 0) {
        const a = Math.max(pos, t0);
        const b = Math.min(pos + len, t1);
        if (b > a) emit(em, lx, ly, dx, dy, a, b);
      } else if (v === 0 && pos >= t0 && pos <= t1) {
        emit(em, lx, ly, dx, dy, pos, pos);
      }
      if (em.truncated) return;
      pos += len;
      if (pos > t1) return;
    }
  }
}
