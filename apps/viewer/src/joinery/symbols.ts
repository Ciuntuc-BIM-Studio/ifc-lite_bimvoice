/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drawings of a joinery type, generated from its spec (not from a mesh),
 * one engine for plans, elevations, sections, sheets and the joinery
 * schedule. Coordinates are the type frame's (`@ifc-lite/create`'s
 * joinery-spec): a plan is (x along the wall, y across, +y exterior), an
 * elevation (x, z) seen from the interior unless asked otherwise, a section
 * (y, z) cut at `cutX`.
 *
 * - Plan: the body sliced at the cut height (frame, mullions and sashes cut,
 *   glass thin), the window boards seen below it, and each door leaf drawn
 *   open at 90° to the interior with its swing arc (a double-acting leaf's
 *   other swing dashed; a sliding leaf beside the opening with an arrow).
 * - Elevation: frame and panel outlines and the opening symbols, DIN 1356 /
 *   SR convention: lines meet at the hinge side (a tilt-and-turn sash has two
 *   triangles: side and bottom), solid where the panel opens towards the
 *   viewer, dashed where it opens away; sliding is an arrow, fixed nothing.
 *   With `hardware`, hinges and handles too (the schedule's hardware scheme).
 * - Section: the body sliced at `cutX`, cut parts heavy, glass thin.
 */

import {
  isDoorLeaf, joineryBoxes, normalisedPanels, panelRect, swingsInPlan,
  type CellRect, type JoineryBox, type JoineryPanel, type JoinerySpec, type PanelOperation,
} from '@ifc-lite/create';

export interface P2 { x: number; y: number }

export type StrokeWeight = 'cut' | 'outline' | 'thin';

export interface JoineryStroke {
  pts: P2[];
  closed?: boolean;
  weight: StrokeWeight;
  dashed?: boolean;
}

const rect = (x0: number, y0: number, x1: number, y1: number, weight: StrokeWeight, dashed?: boolean): JoineryStroke =>
  ({ pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], closed: true, weight, dashed });
const line = (a: P2, b: P2, weight: StrokeWeight, dashed?: boolean): JoineryStroke => ({ pts: [a, b], weight, dashed });

function arc(c: P2, r: number, from: number, to: number, weight: StrokeWeight, dashed?: boolean): JoineryStroke {
  const steps = Math.max(8, Math.ceil(Math.abs(to - from) / (Math.PI / 32)));
  const pts = Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + (to - from) * i / steps;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
  return { pts, weight, dashed };
}

function arrow(a: P2, b: P2, weight: StrokeWeight): JoineryStroke[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const head = Math.min(0.08, len / 3);
  return [
    line(a, b, weight),
    { pts: [{ x: b.x - ux * head - uy * head / 2, y: b.y - uy * head + ux * head / 2 }, b, { x: b.x - ux * head + uy * head / 2, y: b.y - uy * head - ux * head / 2 }], weight },
  ];
}

const hingeLeft = (op: PanelOperation) => op.endsWith('-left');

export interface PlanOptions {
  /** Height of the cut above the joinery's bottom (default: half its height). */
  cutZ?: number;
  /** Draw side-hung window sashes open in plan too (doors always are). */
  windowSwings?: boolean;
}

/** Boxes cut by a horizontal plane at `z` (x, y rectangles). */
function sliceZ(boxes: readonly JoineryBox[], z: number): JoineryBox[] {
  return boxes.filter((b) => b.min[2] <= z && b.max[2] >= z);
}

function doorLeafPlan(spec: JoinerySpec, p: JoineryPanel, r: CellRect): JoineryStroke[] {
  const f = spec.frame;
  const t = spec.sash.leafThickness;
  const yIn = f.offset - f.depth / 2;
  const w = r.x1 - r.x0;
  const left = hingeLeft(p.operation);
  const op = p.operation;
  if (op.startsWith('door-sliding')) {
    // Slides along the interior face, towards its side.
    const dir = left ? -1 : 1;
    return [
      rect(r.x0, yIn - t - 0.01, r.x1, yIn - 0.01, 'outline'),
      ...arrow({ x: (r.x0 + r.x1) / 2 - dir * w / 4, y: yIn - t - 0.08 }, { x: (r.x0 + r.x1) / 2 + dir * w / 4, y: yIn - t - 0.08 }, 'thin'),
    ];
  }
  if (op.startsWith('folding')) {
    // Two halves folded towards the hinge side.
    const hx = left ? r.x0 : r.x1, s = left ? 1 : -1, half = w / 2;
    const fold = { x: hx + s * half * Math.cos(Math.PI / 3), y: yIn - half * Math.sin(Math.PI / 3) };
    return [
      line({ x: hx, y: yIn }, fold, 'outline'),
      line(fold, { x: hx + s * 2 * half * Math.cos(Math.PI / 3), y: yIn }, 'outline'),
    ];
  }
  const hinge = { x: left ? r.x0 : r.x1, y: yIn };
  const s = left ? 1 : -1;
  const out: JoineryStroke[] = [
    // The leaf open at 90° to the interior: a thin rectangle from the hinge.
    rect(hinge.x, hinge.y - w, hinge.x + s * t, hinge.y, 'outline'),
    left ? arc(hinge, w, -Math.PI / 2, 0, 'thin') : arc(hinge, w, Math.PI, 1.5 * Math.PI, 'thin'),
  ];
  if (op.startsWith('double-acting')) {
    const yOut = f.offset + f.depth / 2;
    const h2 = { x: hinge.x, y: yOut };
    out.push(left ? arc(h2, w, 0, Math.PI / 2, 'thin', true) : arc(h2, w, Math.PI / 2, Math.PI, 'thin', true));
  }
  return out;
}

function windowSwingPlan(spec: JoinerySpec, p: JoineryPanel, r: CellRect): JoineryStroke[] {
  const yIn = spec.frame.offset - spec.sash.depth / 2;
  const w = r.x1 - r.x0;
  const left = hingeLeft(p.operation);
  const hinge = { x: left ? r.x0 : r.x1, y: yIn };
  return [
    line(hinge, { x: hinge.x, y: yIn - w }, 'thin'),
    left ? arc(hinge, w, -Math.PI / 2, 0, 'thin', true) : arc(hinge, w, Math.PI, 1.5 * Math.PI, 'thin', true),
  ];
}

export function planSymbol(spec: JoinerySpec, options: PlanOptions = {}): JoineryStroke[] {
  const z = options.cutZ ?? spec.height / 2;
  const boxes = joineryBoxes(spec);
  const out: JoineryStroke[] = [];
  for (const b of sliceZ(boxes, z)) {
    if (b.role === 'leaf' || b.role === 'handle') continue;
    out.push(rect(b.min[0], b.min[1], b.max[0], b.max[1], b.role === 'glass' ? 'thin' : 'cut'));
  }
  for (const b of boxes) if (b.role === 'board' && b.max[2] < z) out.push(rect(b.min[0], b.min[1], b.max[0], b.max[1], 'outline'));
  for (const p of normalisedPanels(spec)) {
    const r = panelRect(spec, p);
    if (r.z0 > z || r.z1 < z) continue;
    if (isDoorLeaf(p.operation)) out.push(...doorLeafPlan(spec, p, r));
    else if (options.windowSwings && swingsInPlan(p.operation)) out.push(...windowSwingPlan(spec, p, r));
  }
  return out;
}

export interface ElevationOptions {
  /** Seen from the interior (default) or the exterior (mirrored, inward-opening symbols dashed). */
  side?: 'interior' | 'exterior';
  /** Hinges and handles: the hardware scheme. */
  hardware?: boolean;
}

/** The opening symbol of one panel, in its rectangle (interior view, x as seen from inside). */
export function openingMarks(op: PanelOperation, r: CellRect, dashed: boolean): JoineryStroke[] {
  const xm = (r.x0 + r.x1) / 2, zm = (r.z0 + r.z1) / 2;
  const P = (x: number, y: number) => ({ x, y });
  const triangleSide = (hingeAtLeft: boolean): JoineryStroke => hingeAtLeft
    ? { pts: [P(r.x1, r.z1), P(r.x0, zm), P(r.x1, r.z0)], weight: 'thin', dashed }
    : { pts: [P(r.x0, r.z1), P(r.x1, zm), P(r.x0, r.z0)], weight: 'thin', dashed };
  const bottom: JoineryStroke = { pts: [P(r.x0, r.z1), P(xm, r.z0), P(r.x1, r.z1)], weight: 'thin', dashed };
  const top: JoineryStroke = { pts: [P(r.x0, r.z0), P(xm, r.z1), P(r.x1, r.z0)], weight: 'thin', dashed };
  const w = r.x1 - r.x0, h = r.z1 - r.z0;
  switch (op) {
    case 'fixed': return [];
    case 'side-left': case 'swing-left': case 'double-acting-left': return [triangleSide(true)];
    case 'side-right': case 'swing-right': case 'double-acting-right': return [triangleSide(false)];
    case 'tilt-turn-left': return [triangleSide(true), bottom];
    case 'tilt-turn-right': return [triangleSide(false), bottom];
    case 'bottom-hung': return [bottom];
    case 'top-hung': return [top];
    case 'pivot-vertical': return [
      { pts: [P(xm, r.z0 - 0.02), P(xm, r.z1 + 0.02)], weight: 'thin', dashed: true },
      { pts: [P(r.x0, r.z1), P(xm, zm), P(r.x0, r.z0)], weight: 'thin', dashed },
      { pts: [P(r.x1, r.z1), P(xm, zm), P(r.x1, r.z0)], weight: 'thin', dashed },
    ];
    case 'pivot-horizontal': return [
      { pts: [P(r.x0 - 0.02, zm), P(r.x1 + 0.02, zm)], weight: 'thin', dashed: true },
      { pts: [P(r.x0, r.z0), P(xm, zm), P(r.x1, r.z0)], weight: 'thin', dashed },
      { pts: [P(r.x0, r.z1), P(xm, zm), P(r.x1, r.z1)], weight: 'thin', dashed },
    ];
    case 'sliding-left': case 'door-sliding-left': return arrow(P(xm + w / 4, zm), P(xm - w / 4, zm), 'thin');
    case 'sliding-right': case 'door-sliding-right': return arrow(P(xm - w / 4, zm), P(xm + w / 4, zm), 'thin');
    case 'sliding-vertical': return arrow(P(xm, zm - h / 4), P(xm, zm + h / 4), 'thin');
    case 'folding-left': return [
      { pts: [P(r.x1, r.z1), P(xm, zm), P(r.x1, r.z0)], weight: 'thin', dashed },
      { pts: [P(xm, r.z1), P(r.x0, zm), P(xm, r.z0)], weight: 'thin', dashed },
    ];
    case 'folding-right': return [
      { pts: [P(r.x0, r.z1), P(xm, zm), P(r.x0, r.z0)], weight: 'thin', dashed },
      { pts: [P(xm, r.z1), P(r.x1, zm), P(xm, r.z0)], weight: 'thin', dashed },
    ];
  }
}

function hardware(spec: JoinerySpec, p: JoineryPanel, r: CellRect): JoineryStroke[] {
  const op = p.operation;
  const out: JoineryStroke[] = [];
  const hw = 0.016, hl = 0.09;
  const leaf = isDoorLeaf(op);
  if (swingsInPlan(op)) {
    const x = hingeLeft(op) ? r.x0 : r.x1 - hw;
    const zs = leaf ? [r.z0 + 0.25, (r.z0 + r.z1) / 2 + 0.2, r.z1 - 0.25] : [r.z0 + 0.12, r.z1 - 0.12 - hl];
    for (const z of zs) out.push(rect(x, z, x + hw, z + hl, 'outline'));
  }
  if (op === 'bottom-hung' || op.startsWith('tilt-turn')) {
    // The tilt hinges along the bottom rail.
    for (const x of [r.x0 + 0.1, r.x1 - 0.1 - hl]) out.push(rect(x, r.z0, x + hl, r.z0 + hw, 'outline'));
  }
  if (op === 'top-hung') for (const x of [r.x0 + 0.1, r.x1 - 0.1 - hl]) out.push(rect(x, r.z1 - hw, x + hl, r.z1, 'outline'));
  // Handle: a lever on the side opposite the hinges.
  const s = spec.sash.width / 2;
  const handleAt = (x: number, z: number, dir: number) => out.push(rect(x - 0.012, z - 0.03, x + 0.012, z + 0.03, 'outline'), line({ x, y: z }, { x: x + dir * 0.11, y: z }, 'outline'));
  const zh = leaf ? Math.min(r.z0 + 1.05, r.z1 - 0.2) : (r.z0 + r.z1) / 2;
  if (op.endsWith('-left') && !op.startsWith('sliding') && !op.startsWith('door-sliding')) handleAt(r.x1 - s, zh, -1);
  else if (op.endsWith('-right') && !op.startsWith('sliding') && !op.startsWith('door-sliding')) handleAt(r.x0 + s, zh, 1);
  else if (op === 'bottom-hung') handleAt((r.x0 + r.x1) / 2, r.z1 - s, 1);
  else if (op === 'top-hung') handleAt((r.x0 + r.x1) / 2, r.z0 + s, 1);
  return out;
}

export function elevationSymbol(spec: JoinerySpec, options: ElevationOptions = {}): JoineryStroke[] {
  const out: JoineryStroke[] = [rect(-spec.width / 2, 0, spec.width / 2, spec.height, 'outline')];
  for (const p of normalisedPanels(spec)) {
    const r = panelRect(spec, p);
    out.push(rect(r.x0, r.z0, r.x1, r.z1, 'outline'));
    const sash = p.operation !== 'fixed' && (!isDoorLeaf(p.operation) || p.glazed);
    const inner = sash ? { x0: r.x0 + spec.sash.width, x1: r.x1 - spec.sash.width, z0: r.z0 + spec.sash.width, z1: r.z1 - spec.sash.width } : r;
    if (sash) out.push(rect(inner.x0, inner.z0, inner.x1, inner.z1, 'thin'));
    out.push(...openingMarks(p.operation, r, options.side === 'exterior'));
    if (options.hardware) out.push(...hardware(spec, p, r));
  }
  if (spec.kind === 'window' && spec.board.exterior > 0 && options.side === 'exterior') {
    out.push(rect(-spec.width / 2 - 0.03, -0.04, spec.width / 2 + 0.03, 0, 'outline'));
  }
  if (options.side === 'exterior') {
    return out.map((s) => ({ ...s, pts: s.pts.map((q) => ({ x: -q.x, y: q.y })) }));
  }
  return out;
}

export interface SectionOptions {
  /** Where along the width the vertical cut runs (default: the middle of the first column). */
  cutX?: number;
}

export function sectionSymbol(spec: JoinerySpec, options: SectionOptions = {}): JoineryStroke[] {
  const first = normalisedPanels(spec).find((p) => p.col === 0);
  const r = first ? panelRect(spec, first) : null;
  const x = options.cutX ?? (r ? (r.x0 + r.x1) / 2 : 0);
  const out: JoineryStroke[] = [];
  for (const b of joineryBoxes(spec)) {
    if (b.role === 'handle' || b.min[0] > x || b.max[0] < x) continue;
    out.push(rect(b.min[1], b.min[2], b.max[1], b.max[2], b.role === 'glass' ? 'thin' : 'cut'));
  }
  return out;
}

/** The extent of a set of strokes. */
export function strokeBounds(strokes: readonly JoineryStroke[]): { min: P2; max: P2 } {
  const min = { x: Infinity, y: Infinity }, max = { x: -Infinity, y: -Infinity };
  for (const s of strokes) for (const p of s.pts) {
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y);
  }
  return { min, max };
}
