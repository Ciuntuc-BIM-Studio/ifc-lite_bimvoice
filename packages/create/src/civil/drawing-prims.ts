/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The primitives civil drawings are made of, in DRAWING metres (the units a
 * drafting view uses: 1 m of drawing is 1 m at the drawing's scale; y up).
 * Text sizes are paper millimetres, so a label prints the same size at any
 * scale; `paper(mm, scale)` turns a paper length into drawing metres.
 * Every primitive carries a pen: what it is, which the viewer maps to a
 * layer, a weight and a line type.
 */

export type P2 = [number, number];

export type DrawPen = 'frame' | 'grid' | 'ground' | 'grade' | 'course' | 'component' | 'daylight' | 'axis' | 'label' | 'band' | 'geometry';

export type DrawPrim =
  | { kind: 'line'; a: P2; b: P2; pen: DrawPen }
  | { kind: 'poly'; pts: P2[]; closed: boolean; pen: DrawPen; fill?: string }
  /** `rotate`: degrees, counter-clockwise (90 reads bottom to top). */
  | { kind: 'text'; at: P2; text: string; size: number; anchor: 'start' | 'middle' | 'end'; pen: DrawPen; rotate?: number };

export interface CivilDrawing {
  prims: DrawPrim[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Paper millimetres as drawing metres at 1 : `scale`. */
export const paper = (mm: number, scale: number): number => (mm * scale) / 1000;

export function boundsOf(prims: readonly DrawPrim[]): CivilDrawing['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: P2) => { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); };
  for (const p of prims) {
    if (p.kind === 'line') { add(p.a); add(p.b); } else if (p.kind === 'poly') p.pts.forEach(add); else add(p.at);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/** Move every primitive by (dx, dy). */
export function translatePrims(prims: readonly DrawPrim[], dx: number, dy: number): DrawPrim[] {
  const m = (p: P2): P2 => [p[0] + dx, p[1] + dy];
  return prims.map((p) => (p.kind === 'line' ? { ...p, a: m(p.a), b: m(p.b) } : p.kind === 'poly' ? { ...p, pts: p.pts.map(m) } : { ...p, at: m(p.at) }));
}

export const fmt = (v: number, digits = 2) => (Math.abs(v) < 0.5 * 10 ** -digits ? (0).toFixed(digits) : v.toFixed(digits));
