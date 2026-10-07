/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation geometry: where a dimension's lines, arrows and value go,
 * the geometric "skeleton" an annotation is picked, bounded and snapped by,
 * and the move / rotate / mirror of any entity shape (geometry delegates to
 * `transform.ts`; annotations map their points and keep text readable).
 */

import { nearestOnShape, shapeBounds } from './curves';
import { mirrorShape, rotateShape, translateShape } from './transform';
import { add, dist, mirrorPt, rotatePt, scale, sub } from './vec';
import { isGeometry, type AnnotationShape, type DraftShape, type EntityShape, type Pt } from './types';

export interface DimensionLayout {
  /** Extension and dimension lines. */
  lines: { a: Pt; b: Pt }[];
  /** Arrow / tick tips with the direction they point. */
  ticks: { at: Pt; dir: Pt }[];
  textAt: Pt;
  /** Text direction in drawing space (radians). */
  textAngle: number;
  label: string;
}

const EXT_GAP = 0.1;
const EXT_OVER = 0.15;

export function formatLength(m: number): string {
  return m.toFixed(2);
}

export function formatLevel(m: number): string {
  if (Math.abs(m) < 0.005) return '±0.00';
  return `${m > 0 ? '+' : '−'}${Math.abs(m).toFixed(2)}`;
}

function unit(v: Pt): Pt {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
}

/** A linear / aligned dimension: extension lines from the points to the dimension line through `at`. */
function linearLayout(a: Pt, b: Pt, at: Pt, variant: 'aligned' | 'linear', text?: string): DimensionLayout {
  let dir: Pt;
  if (variant === 'aligned') {
    dir = unit(sub(b, a));
  } else {
    // Linear: horizontal or vertical, whichever way the line was pulled.
    const mid = scale(add(a, b), 0.5);
    dir = Math.abs(at.y - mid.y) >= Math.abs(at.x - mid.x) ? { x: 1, y: 0 } : { x: 0, y: 1 };
  }
  const n = { x: -dir.y, y: dir.x };
  const offA = (at.x - a.x) * n.x + (at.y - a.y) * n.y;
  const offB = (at.x - b.x) * n.x + (at.y - b.y) * n.y;
  const pa = add(a, scale(n, offA));
  const pb = add(b, scale(n, offB));
  const extA = { a: add(a, scale(n, Math.sign(offA) * Math.min(EXT_GAP, Math.abs(offA)))), b: add(pa, scale(n, Math.sign(offA) * EXT_OVER)) };
  const extB = { a: add(b, scale(n, Math.sign(offB) * Math.min(EXT_GAP, Math.abs(offB)))), b: add(pb, scale(n, Math.sign(offB) * EXT_OVER)) };
  const value = Math.abs((b.x - a.x) * dir.x + (b.y - a.y) * dir.y);
  const along = unit(sub(pb, pa));
  return {
    lines: [extA, extB, { a: pa, b: pb }],
    ticks: [{ at: pa, dir: scale(along, -1) }, { at: pb, dir: along }],
    textAt: scale(add(pa, pb), 0.5),
    textAngle: Math.atan2(along.y, along.x),
    label: text ?? formatLength(value),
  };
}

export function dimensionLayout(shape: Extract<AnnotationShape, { type: 'dimension' | 'radial' | 'angular' }>): DimensionLayout {
  if (shape.type === 'dimension') return linearLayout(shape.a, shape.b, shape.at, shape.variant, shape.text);
  if (shape.type === 'radial') {
    const dir = unit(sub(shape.at, shape.c));
    const rim = add(shape.c, scale(dir, shape.r));
    const from = shape.diameter ? add(shape.c, scale(dir, -shape.r)) : shape.c;
    return {
      lines: [{ a: from, b: dist(shape.at, shape.c) > shape.r ? shape.at : rim }],
      ticks: shape.diameter ? [{ at: rim, dir }, { at: from, dir: scale(dir, -1) }] : [{ at: rim, dir }],
      textAt: shape.at,
      textAngle: Math.atan2(dir.y, dir.x),
      label: `${shape.diameter ? 'Ø' : 'R'} ${formatLength(shape.diameter ? shape.r * 2 : shape.r)}`,
    };
  }
  const r = Math.max(dist(shape.at, shape.c), 1e-6);
  const a0 = Math.atan2(shape.a.y - shape.c.y, shape.a.x - shape.c.x);
  const a1 = Math.atan2(shape.b.y - shape.c.y, shape.b.x - shape.c.x);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  const steps = 24;
  const lines: { a: Pt; b: Pt }[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + (sweep * i) / steps;
    const t1 = a0 + (sweep * (i + 1)) / steps;
    lines.push({ a: { x: shape.c.x + r * Math.cos(t0), y: shape.c.y + r * Math.sin(t0) }, b: { x: shape.c.x + r * Math.cos(t1), y: shape.c.y + r * Math.sin(t1) } });
  }
  const mid = a0 + sweep / 2;
  return {
    lines,
    ticks: [],
    textAt: { x: shape.c.x + r * Math.cos(mid), y: shape.c.y + r * Math.sin(mid) },
    textAngle: mid + Math.PI / 2,
    label: `${((Math.abs(sweep) * 180) / Math.PI).toFixed(1)}°`,
  };
}

/**
 * Which way is "up on screen" in drawing y for the view being annotated
 * (+1 for sections / elevations, −1 for plans, whose drawing y points down
 * on screen). Text boxes grow upward on screen.
 */
let screenUp: 1 | -1 = 1;
export function setAnnotationScreenUp(sign: 1 | -1): void {
  screenUp = sign;
}

/** Model metres per hatch-pattern unit at scale 1: patterns are drawn in paper millimetres, views default to 1:100. */
export const HATCH_UNIT_M = 0.1;

/** A text box's corners: `width` approximated from the character count. */
export function textBox(p: Pt, text: string, height: number, rotation: number): Pt[] {
  const width = Math.max(1, text.length) * height * 0.62;
  const h = height * screenUp;
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: h }, { x: 0, y: h }];
  return corners.map((c) => rotatePt(add(p, c), p, rotation));
}

/** The lines an entity is picked, bounded and snapped by. */
export function entitySkeleton(shape: EntityShape): DraftShape[] {
  if (isGeometry(shape)) return [shape];
  switch (shape.type) {
    case 'text':
      return [{ type: 'polyline', pts: textBox(shape.p, shape.text, shape.height, shape.rotation), closed: true }];
    case 'leader': {
      const end = shape.pts[shape.pts.length - 1];
      return [{ type: 'polyline', pts: shape.pts, closed: false }, { type: 'polyline', pts: textBox(end, shape.text, shape.height, 0), closed: true }];
    }
    case 'level': {
      const h = shape.height * screenUp;
      return [
        { type: 'polyline', pts: [shape.p, { x: shape.p.x - shape.height, y: shape.p.y + h }, { x: shape.p.x + shape.height, y: shape.p.y + h }], closed: true },
        { type: 'line', a: shape.p, b: { x: shape.p.x + shape.height * 5, y: shape.p.y } },
      ];
    }
    case 'hatch':
      return shape.loops.filter((l) => l.length >= 3).map((pts) => ({ type: 'polyline', pts, closed: true }));
    default:
      return dimensionLayout(shape).lines.map((l) => ({ type: 'line', a: l.a, b: l.b }));
  }
}

export function entityBounds(shape: EntityShape): { min: Pt; max: Pt } {
  const parts = entitySkeleton(shape).map(shapeBounds);
  if (parts.length === 0) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  return {
    min: { x: Math.min(...parts.map((b) => b.min.x)), y: Math.min(...parts.map((b) => b.min.y)) },
    max: { x: Math.max(...parts.map((b) => b.max.x)), y: Math.max(...parts.map((b) => b.max.y)) },
  };
}

/** Distance from `p` to the entity; inside a hatch or a text box counts as on it. */
export function nearestOnEntity(shape: EntityShape, p: Pt): { point: Pt; dist: number } {
  let best = { point: p, dist: Infinity };
  for (const part of entitySkeleton(shape)) {
    const hit = nearestOnShape(part, p);
    if (hit.dist < best.dist) best = hit;
  }
  if ((shape.type === 'hatch' || shape.type === 'text') && insideAny(entitySkeleton(shape), p)) return { point: p, dist: 0 };
  return best;
}

function insideAny(parts: DraftShape[], p: Pt): boolean {
  let inside = false;
  for (const part of parts) {
    if (part.type !== 'polyline') continue;
    const pts = part.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i].y > p.y) !== (pts[j].y > p.y) && p.x < ((pts[j].x - pts[i].x) * (p.y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
    }
  }
  return inside;
}

function mapAnnotation(shape: AnnotationShape, f: (p: Pt) => Pt): AnnotationShape {
  switch (shape.type) {
    case 'text':
      return { ...shape, p: f(shape.p) };
    case 'leader':
      return { ...shape, pts: shape.pts.map(f) };
    case 'dimension':
      return { ...shape, a: f(shape.a), b: f(shape.b), at: f(shape.at) };
    case 'radial':
      return { ...shape, c: f(shape.c), at: f(shape.at) };
    case 'angular':
      return { ...shape, c: f(shape.c), a: f(shape.a), b: f(shape.b), at: f(shape.at) };
    case 'level':
      return { ...shape, p: f(shape.p) };
    case 'hatch':
      return { ...shape, loops: shape.loops.map((l) => l.map(f)) };
  }
}

export function translateEntity(shape: EntityShape, d: Pt): EntityShape {
  return isGeometry(shape) ? translateShape(shape, d) : mapAnnotation(shape, (p) => add(p, d));
}

export function rotateEntity(shape: EntityShape, center: Pt, angle: number): EntityShape {
  if (isGeometry(shape)) return rotateShape(shape, center, angle);
  const mapped = mapAnnotation(shape, (p) => rotatePt(p, center, angle));
  if (mapped.type === 'text') return { ...mapped, rotation: mapped.rotation + angle };
  if (mapped.type === 'hatch') return { ...mapped, angle: mapped.angle + (angle * 180) / Math.PI };
  return mapped;
}

/** Mirror: points reflect, text stays readable (not mirrored). */
export function mirrorEntity(shape: EntityShape, a: Pt, b: Pt): EntityShape {
  return isGeometry(shape) ? mirrorShape(shape, a, b) : mapAnnotation(shape, (p) => mirrorPt(p, a, b));
}
