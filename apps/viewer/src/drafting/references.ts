/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The generated drawing as drafting references: every visible line and
 * every cut-polygon edge as a line shape, indexed once per drawing, so
 * snaps and trim / extend boundaries see the model's geometry.
 */

import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { SnapIndex } from './snaps';
import type { DraftShape, Pt } from './types';

export interface ReferenceSet {
  shapes: DraftShape[];
  index: SnapIndex;
}

const cache = new WeakMap<Drawing2D, ReferenceSet>();

function polygonEdges(outer: readonly Pt[], into: DraftShape[]): void {
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a.x !== b.x || a.y !== b.y) into.push({ type: 'line', a, b });
  }
}

export function referenceSet(drawing: Drawing2D, includeHidden: boolean): ReferenceSet {
  const cached = cache.get(drawing);
  if (cached) return cached;
  const shapes: DraftShape[] = [];
  for (const line of drawing.lines) {
    if (!includeHidden && line.visibility === 'hidden') continue;
    shapes.push({ type: 'line', a: line.line.start, b: line.line.end });
  }
  for (const polygon of drawing.cutPolygons) {
    polygonEdges(polygon.polygon.outer, shapes);
    for (const hole of polygon.polygon.holes) polygonEdges(hole, shapes);
  }
  const set = { shapes, index: new SnapIndex(shapes) };
  cache.set(drawing, set);
  return set;
}

/** The reference shapes whose bounds meet the box. */
export function referencesIn(set: ReferenceSet, min: Pt, max: Pt): DraftShape[] {
  return set.index.query(min, max).map((i) => set.shapes[i]);
}
