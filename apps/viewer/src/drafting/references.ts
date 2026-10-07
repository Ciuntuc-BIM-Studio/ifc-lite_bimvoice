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
import { pointInPolygon, signedArea } from './offset';
import { nearestOnShape } from './curves';
import type { DraftShape, Pt } from './types';

export interface ReferenceSet {
  shapes: DraftShape[];
  /** The renderer (global) id of the element each shape was drawn from. */
  owners: number[];
  index: SnapIndex;
}

const cache = new WeakMap<Drawing2D, ReferenceSet>();

function polygonEdges(outer: readonly Pt[], owner: number, into: DraftShape[], owners: number[]): void {
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a.x !== b.x || a.y !== b.y) {
      into.push({ type: 'line', a, b });
      owners.push(owner);
    }
  }
}

export function referenceSet(drawing: Drawing2D, includeHidden: boolean): ReferenceSet {
  const cached = cache.get(drawing);
  if (cached) return cached;
  const shapes: DraftShape[] = [];
  const owners: number[] = [];
  for (const line of drawing.lines) {
    if (!includeHidden && line.visibility === 'hidden') continue;
    shapes.push({ type: 'line', a: line.line.start, b: line.line.end });
    owners.push(line.entityId);
  }
  for (const polygon of drawing.cutPolygons) {
    polygonEdges(polygon.polygon.outer, polygon.entityId, shapes, owners);
    for (const hole of polygon.polygon.holes) polygonEdges(hole, polygon.entityId, shapes, owners);
  }
  const set = { shapes, owners, index: new SnapIndex(shapes) };
  cache.set(drawing, set);
  return set;
}

/**
 * The model element under a drawing point: the smallest cut outline that
 * contains it (as the plan view picks), else the element of the nearest
 * drawn line within `tolerance`. `null` when nothing is there.
 */
export function pickModelElement(drawing: Drawing2D, set: ReferenceSet, p: Pt, tolerance: number): number | null {
  let best: { id: number; area: number } | null = null;
  for (const polygon of drawing.cutPolygons) {
    const outer = polygon.polygon.outer;
    if (!pointInPolygon(p, outer) || polygon.polygon.holes.some((h) => pointInPolygon(p, h))) continue;
    const area = Math.abs(signedArea(outer));
    if (!best || area < best.area) best = { id: polygon.entityId, area };
  }
  if (best) return best.id;
  let nearest: { id: number; d: number } | null = null;
  const min = { x: p.x - tolerance, y: p.y - tolerance };
  const max = { x: p.x + tolerance, y: p.y + tolerance };
  for (const i of set.index.query(min, max)) {
    const d = nearestOnShape(set.shapes[i], p).dist;
    if (d <= tolerance && (!nearest || d < nearest.d)) nearest = { id: set.owners[i], d };
  }
  return nearest?.id ?? null;
}

/** The reference shapes whose bounds meet the box. */
export function referencesIn(set: ReferenceSet, min: Pt, max: Pt): DraftShape[] {
  return set.index.query(min, max).map((i) => set.shapes[i]);
}
