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

type Box = { min: Pt; max: Pt };
const elementShapes = new WeakMap<Drawing2D, Map<number, { box: Box; edges: [Pt, Pt][]; areas: Pt[][] }>>();

/** Every element's drawn edges, its cut outlines and their bounds, once per drawing. */
function shapesByElement(drawing: Drawing2D) {
  const cached = elementShapes.get(drawing);
  if (cached) return cached;
  const map = new Map<number, { box: Box; edges: [Pt, Pt][]; areas: Pt[][] }>();
  const of = (id: number) => {
    let e = map.get(id);
    if (!e) map.set(id, e = { box: { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } }, edges: [], areas: [] });
    return e;
  };
  const grow = (b: Box, p: Pt) => { b.min.x = Math.min(b.min.x, p.x); b.min.y = Math.min(b.min.y, p.y); b.max.x = Math.max(b.max.x, p.x); b.max.y = Math.max(b.max.y, p.y); };
  for (const line of drawing.lines) {
    if (line.visibility === 'hidden') continue;
    const e = of(line.entityId);
    e.edges.push([line.line.start, line.line.end]);
    grow(e.box, line.line.start); grow(e.box, line.line.end);
  }
  for (const polygon of drawing.cutPolygons) {
    const e = of(polygon.entityId), outer = polygon.polygon.outer;
    e.areas.push(outer as Pt[]);
    outer.forEach((p, i) => { e.edges.push([p, outer[(i + 1) % outer.length]]); grow(e.box, p); });
  }
  elementShapes.set(drawing, map);
  return map;
}

/** Whether the segment a–b meets the box (Liang–Barsky). */
function segmentMeetsBox(a: Pt, b: Pt, { min, max }: Box): boolean {
  let t0 = 0, t1 = 1;
  const d = { x: b.x - a.x, y: b.y - a.y };
  for (const [p, q] of [[-d.x, a.x - min.x], [d.x, max.x - a.x], [-d.y, a.y - min.y], [d.y, max.y - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * The model elements a drawn window selects: wholly inside it, or for a
 * crossing window, any whose lines or cut outlines it touches (a window
 * within an outline touches it too).
 */
export function modelElementsInWindow(drawing: Drawing2D, min: Pt, max: Pt, crossing: boolean): number[] {
  const window: Box = { min, max };
  const centre = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
  const out: number[] = [];
  for (const [id, e] of shapesByElement(drawing)) {
    const { box } = e;
    if (box.max.x < min.x || box.min.x > max.x || box.max.y < min.y || box.min.y > max.y) continue;
    const inside = box.min.x >= min.x && box.max.x <= max.x && box.min.y >= min.y && box.max.y <= max.y;
    if (inside || (crossing && (e.edges.some(([a, b]) => segmentMeetsBox(a, b, window)) || e.areas.some((ring) => pointInPolygon(centre, ring))))) out.push(id);
  }
  return out;
}
