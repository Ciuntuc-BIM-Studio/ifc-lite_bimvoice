/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Grips: the handles a selected entity shows on the canvas, and what
 * dragging one does to the shape.
 *
 *  - dimension: its two measured points, its line (`at`) and its value
 *    (`text`: moving it sets the dimension's own text position, `textAt`);
 *  - radial / angular: the line / arc position; text, level: the insertion
 *    point; leader: every vertex;
 *  - axis: its two ends (the bubbles follow);
 *  - line, polyline: every vertex; circle, arc: the centre.
 */

import { dimensionLayout } from './annotation';
import type { EntityShape, Pt } from './types';

export interface Grip {
  /** The entity it belongs to. */
  id: string;
  key: string;
  at: Pt;
}

export function gripsOf(id: string, shape: EntityShape): Grip[] {
  const g = (key: string, at: Pt): Grip => ({ id, key, at });
  switch (shape.type) {
    case 'line':
    case 'axis': return [g('a', shape.a), g('b', shape.b)];
    case 'polyline': return shape.pts.map((p, i) => g(`pt${i}`, p));
    case 'circle':
    case 'arc': return [g('c', shape.c)];
    case 'text':
    case 'level': return [g('p', shape.p)];
    case 'leader': return shape.pts.map((p, i) => g(`pt${i}`, p));
    case 'dimension': return [g('a', shape.a), g('b', shape.b), g('at', shape.at), g('text', dimensionLayout(shape).textAt)];
    case 'radial':
    case 'angular': return [g('at', shape.at)];
    default: return [];
  }
}

/** `shape` with grip `key` dragged to `p`. */
export function moveGrip(shape: EntityShape, key: string, p: Pt): EntityShape {
  const vertex = /^pt(\d+)$/.exec(key);
  switch (shape.type) {
    case 'line':
    case 'axis': return key === 'a' ? { ...shape, a: p } : key === 'b' ? { ...shape, b: p } : shape;
    case 'polyline':
    case 'leader':
      if (!vertex) return shape;
      return { ...shape, pts: shape.pts.map((q, i) => (i === Number(vertex[1]) ? p : q)) };
    case 'circle':
    case 'arc': return key === 'c' ? { ...shape, c: p } : shape;
    case 'text':
    case 'level': return key === 'p' ? { ...shape, p } : shape;
    case 'dimension':
      if (key === 'text') return { ...shape, textAt: p };
      // Moving the line takes a moved value along (it stays where it was relative to the line).
      if (key === 'at') {
        if (!shape.textAt) return { ...shape, at: p };
        const d = { x: p.x - shape.at.x, y: p.y - shape.at.y };
        return { ...shape, at: p, textAt: { x: shape.textAt.x + d.x, y: shape.textAt.y + d.y } };
      }
      return key === 'a' || key === 'b' ? { ...shape, [key]: p } : shape;
    case 'radial':
    case 'angular': return key === 'at' ? { ...shape, at: p } : shape;
    default: return shape;
  }
}

/** The grip within `tolerance` (drawing units) of `p`, nearest first. */
export function gripAt(grips: readonly Grip[], p: Pt, tolerance: number): Grip | null {
  let best: Grip | null = null;
  let bestD = tolerance;
  for (const grip of grips) {
    const d = Math.hypot(grip.at.x - p.x, grip.at.y - p.y);
    if (d <= bestD) { best = grip; bestD = d; }
  }
  return best;
}
