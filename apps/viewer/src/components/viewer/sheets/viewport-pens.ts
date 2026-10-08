/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A viewport's drawing as paper pens, honouring its view's Visibility /
 * Graphics (`project/view-graphics.ts`): the drawing arrives already styled
 * (hidden categories dropped, parts relabelled, cut fills stamped); here
 * each category's line colour and weight pick the pen, cut fills keep their
 * colour, and category cut hatches are laid out in drawing units. Paths are
 * grouped by pen, so a sheet stays a handful of SVG paths.
 */

import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { drawingToScreen, type SectionAxisName, type ViewTransform } from '@/drafting/frame';
import { HATCH_UNIT_M } from '@/drafting/annotation';
import { findPattern } from '@/drafting/hatch/library';
import { hatchSegments } from '@/drafting/hatch/fill';
import type { HatchPattern } from '@/drafting/hatch/pattern';
import { categoryOf, cutHatches } from '@/project/view-graphics';
import type { CategoryLineWeight, ViewGraphics } from '@/project/types';

export interface Pen {
  d: string;
  stroke: string | null;
  /** Paper millimetres. */
  width: number;
  fill: string | null;
  dash?: string;
  /** The DXF layer it exports on. */
  layer: string;
}

/** Default pens, paper millimetres. */
export const PEN = { cut: 0.5, seen: 0.25, hidden: 0.18, hatch: 0.13 };
const WEIGHT_MM: Record<CategoryLineWeight, number> = { heavy: 0.7, medium: 0.5, light: 0.25, hairline: 0.13 };
const DEFAULT_FILL = '#d4d4d8';

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

export function viewportPens(
  drawing: Drawing2D, graphics: ViewGraphics | undefined, t: ViewTransform, axis: SectionAxisName, extraPatterns: readonly HatchPattern[],
): Pen[] {
  const pens = new Map<string, Pen>();
  const add = (key: string, base: Omit<Pen, 'd'>, d: string) => {
    const pen = pens.get(key);
    if (pen) pen.d += d;
    else pens.set(key, { ...base, d });
  };
  const pt = (p: { x: number; y: number }) => {
    const s = drawingToScreen(p, t, axis);
    return `${s.x.toFixed(2)} ${s.y.toFixed(2)}`;
  };
  const loop = (pts: readonly { x: number; y: number }[]) => `M${pts.map(pt).join('L')}Z`;
  const style = (ifcType: string | undefined) => {
    const id = ifcType ? categoryOf(ifcType) : null;
    return id ? graphics?.categories?.[id] : undefined;
  };

  for (const polygon of drawing.cutPolygons) {
    const fill = polygon.color && style(polygon.ifcType)?.fillColor ? hex(polygon.color) : DEFAULT_FILL;
    add(`fill:${fill}`, { stroke: null, width: 0, fill, layer: 'FILL' }, [polygon.polygon.outer, ...polygon.polygon.holes].map(loop).join(''));
  }
  for (const line of drawing.lines) {
    const g = style(line.ifcType);
    const d = `M${pt(line.line.start)}L${pt(line.line.end)}`;
    const color = g?.lineColor ?? '#000000';
    if (line.visibility === 'hidden' || line.category === 'hidden') {
      add(`hidden:${color}`, { stroke: color, width: PEN.hidden, fill: null, dash: '1.5 1', layer: 'HIDDEN' }, d);
      continue;
    }
    const cut = line.category === 'cut';
    const weight = g?.lineWeight ? WEIGHT_MM[g.lineWeight] * (cut ? 1 : 0.5) : cut ? PEN.cut : PEN.seen;
    add(`${cut ? 'cut' : 'seen'}:${color}:${weight}`, { stroke: color, width: weight, fill: null, layer: cut ? 'CUT' : 'SEEN' }, d);
  }
  for (const h of cutHatches(drawing, graphics)) {
    const pattern = findPattern(h.pattern, extraPatterns);
    if (!pattern) continue;
    if (pattern.solid) {
      add(`solid:${h.color}`, { stroke: null, width: 0, fill: h.color, layer: 'HATCH' }, h.loops.map(loop).join(''));
      continue;
    }
    const segments = hatchSegments(h.loops, pattern, { scale: h.scale * HATCH_UNIT_M, angleDeg: 0, maxSegments: 20000 }).segments;
    add(`hatch:${h.color}`, { stroke: h.color, width: PEN.hatch, fill: null, layer: 'HATCH' }, segments.map((s) => `M${pt(s.a)}L${pt(s.b)}`).join(''));
  }
  // Fills first, then hatches, then lines (hidden, seen, cut).
  const order = (p: Pen) => (p.fill ? 0 : p.width === PEN.hatch ? 1 : p.dash ? 2 : p.width < PEN.cut ? 3 : 4);
  return [...pens.values()].sort((a, b) => order(a) - order(b));
}
