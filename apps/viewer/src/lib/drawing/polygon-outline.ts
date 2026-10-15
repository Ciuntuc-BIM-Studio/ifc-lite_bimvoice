/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A cut polygon's outline on a canvas, leaving out its seams: the sides it
 * shares with another element's band of the same material
 * (`project/material-drawing.ts`), so a mitred corner of two walls of one
 * material reads as one piece. Only the drawing joins them; the elements
 * stay apart. Sides are numbered over the outer loop, then the holes.
 */

import type { DrawingPolygon } from '@ifc-lite/drawing-2d';

type At = (x: number, y: number) => { x: number; y: number };

export type SeamedPolygon = DrawingPolygon & { seams?: ReadonlySet<number> };

const loopsOf = (p: DrawingPolygon) => [p.polygon.outer, ...p.polygon.holes].filter((l) => l.length > 0);

/** Add the polygon's outline to the current path, its seams left out. */
export function traceOutline(ctx: CanvasRenderingContext2D, polygon: SeamedPolygon, at: At): void {
  const seams = polygon.seams;
  let side = 0;
  for (const loop of loopsOf(polygon)) {
    const first = at(loop[0].x, loop[0].y);
    ctx.moveTo(first.x, first.y);
    if (!seams?.size) {
      for (let i = 1; i < loop.length; i++) { const q = at(loop[i].x, loop[i].y); ctx.lineTo(q.x, q.y); }
      ctx.closePath();
      side += loop.length;
      continue;
    }
    for (let i = 0; i < loop.length; i++, side++) {
      const q = at(loop[(i + 1) % loop.length].x, loop[(i + 1) % loop.length].y);
      if (seams.has(side)) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    }
  }
}

/** Add only the polygon's seams to the current path (stroked in its fill colour, they close the hairline between two fills). */
export function traceSeams(ctx: CanvasRenderingContext2D, polygon: SeamedPolygon, at: At): boolean {
  const seams = polygon.seams;
  if (!seams?.size) return false;
  let side = 0;
  for (const loop of loopsOf(polygon)) {
    for (let i = 0; i < loop.length; i++, side++) {
      if (!seams.has(side)) continue;
      const a = at(loop[i].x, loop[i].y), b = at(loop[(i + 1) % loop.length].x, loop[(i + 1) % loop.length].y);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
  }
  return true;
}
