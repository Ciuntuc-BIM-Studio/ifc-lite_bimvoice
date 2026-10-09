/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A cut drawn by its building materials (`project/materials.ts`), the
 * ArchiCAD way, from the per-layer cut polygons the drawing carries
 * (`DrawingPolygon.materialId`):
 *
 * - each layer band takes its material's hatch, fill and hatch pen;
 * - where bands of the SAME material of two elements touch (insulation round
 *   a mitred corner, a slab's screed into the next), the cut line between
 *   them goes, so the material reads as one;
 * - a membrane — a layer under 2 mm (which the geometry engine does not cut
 *   into a band of its own) or a material marked as one — is drawn as a heavy
 *   dashed line where it lies: on the interface between its neighbouring
 *   layers, or along the middle of its own thin band.
 *
 * Pure geometry over a `MaterialResolver`, so it is tested without a model.
 */

import type { Drawing2D, DrawingLine, DrawingPolygon } from '@ifc-lite/drawing-2d';
import type { DraftShape, Pt } from '@/drafting/types';
import type { ProjectMaterial } from './types';

export interface LayerRef {
  /** The layer's IfcMaterial (same id space as `DrawingPolygon.materialId`). */
  materialId: number | null;
  name: string;
  thickness: number;
}

export interface MaterialResolver {
  /** The graphics of a polygon's material, or null when it has none. */
  graphics(polygon: DrawingPolygon): (ProjectMaterial & { auto: boolean }) | null;
  /** The element's layers in order, when it has a layer set. */
  layers(entityId: number, modelIndex: number): LayerRef[] | null;
  /** Whether a layer is drawn as a membrane. */
  membrane(layer: LayerRef): boolean;
}

export interface MaterialHatch {
  loops: Pt[][];
  pattern: string;
  scale: number;
  pen: NonNullable<ProjectMaterial['hatchPen']>;
}

export interface MaterialDrawing {
  hatches: MaterialHatch[];
  /** Cut lines to leave out (a boundary inside one material). */
  dropLines: Set<DrawingLine>;
  /** Fill per polygon (null: no fill). */
  fills: Map<DrawingPolygon, string | null>;
  /** Polygons not drawn at all (a membrane's own thin band). */
  hidePolygons: Set<DrawingPolygon>;
  /** Membrane lines, drawing coordinates. */
  membranes: DraftShape[];
}

const TOL = 0.002;

type Seg = { a: Pt; b: Pt };

const len = (s: Seg) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);

/** Whether two segments lie on one line and overlap over most of the shorter. */
export function coincide(p: Seg, q: Seg, tol = TOL): boolean {
  const lp = len(p), lq = len(q);
  if (lp < tol || lq < tol) return false;
  const ux = (p.b.x - p.a.x) / lp, uy = (p.b.y - p.a.y) / lp;
  const off = (r: Pt) => Math.abs((r.x - p.a.x) * uy - (r.y - p.a.y) * ux);
  if (off(q.a) > tol || off(q.b) > tol) return false;
  const t = (r: Pt) => (r.x - p.a.x) * ux + (r.y - p.a.y) * uy;
  const lo = Math.max(0, Math.min(t(q.a), t(q.b))), hi = Math.min(lp, Math.max(t(q.a), t(q.b)));
  return hi - lo >= 0.5 * Math.min(lp, lq);
}

function edges(poly: DrawingPolygon): Seg[] {
  const out: Seg[] = [];
  for (const loop of [poly.polygon.outer, ...poly.polygon.holes]) {
    for (let i = 0; i < loop.length; i++) out.push({ a: loop[i], b: loop[(i + 1) % loop.length] });
  }
  return out;
}

/** A coarse spatial hash of segments by their midpoint cell (and neighbours on lookup). */
class SegIndex<T> {
  private cells = new Map<string, { seg: Seg; item: T }[]>();
  constructor(private size = 0.5) {}
  private key(x: number, y: number) { return `${Math.floor(x / this.size)}:${Math.floor(y / this.size)}`; }
  add(seg: Seg, item: T) {
    const k = this.key((seg.a.x + seg.b.x) / 2, (seg.a.y + seg.b.y) / 2);
    const list = this.cells.get(k) ?? [];
    list.push({ seg, item });
    this.cells.set(k, list);
  }
  near(seg: Seg): { seg: Seg; item: T }[] {
    const cx = Math.floor((seg.a.x + seg.b.x) / 2 / this.size), cy = Math.floor((seg.a.y + seg.b.y) / 2 / this.size);
    const out: { seg: Seg; item: T }[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(...(this.cells.get(`${cx + dx}:${cy + dy}`) ?? []));
    return out;
  }
}

/** The middle line of a thin band (its two long sides averaged), or null. */
function midline(poly: DrawingPolygon): DraftShape | null {
  const pts = poly.polygon.outer;
  if (pts.length < 3) return null;
  // The longest edge gives the band's direction; project every point on it.
  let best: Seg | null = null;
  for (const e of edges(poly)) if (!best || len(e) > len(best)) best = e;
  if (!best) return null;
  const l = len(best), ux = (best.b.x - best.a.x) / l, uy = (best.b.y - best.a.y) / l;
  let t0 = Infinity, t1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const p of pts) {
    const t = (p.x - best.a.x) * ux + (p.y - best.a.y) * uy, n = -(p.x - best.a.x) * uy + (p.y - best.a.y) * ux;
    t0 = Math.min(t0, t); t1 = Math.max(t1, t); n0 = Math.min(n0, n); n1 = Math.max(n1, n);
  }
  const nm = (n0 + n1) / 2;
  const at = (t: number): Pt => ({ x: best!.a.x + ux * t - uy * nm, y: best!.a.y + uy * t + ux * nm });
  return { type: 'line', a: at(t0), b: at(t1) };
}

export function materialDrawing(drawing: Drawing2D, r: MaterialResolver): MaterialDrawing {
  const out: MaterialDrawing = { hatches: [], dropLines: new Set(), fills: new Map(), hidePolygons: new Set(), membranes: [] };
  const named = drawing.cutPolygons.map((p) => ({ p, g: p.materialId !== undefined ? r.graphics(p) : null }));

  // Bands: hatch and fill, or (a membrane's own band) a line along its middle.
  for (const { p, g } of named) {
    if (!g) continue;
    if (g.membrane) {
      out.hidePolygons.add(p);
      const m = midline(p);
      if (m) out.membranes.push(m);
      continue;
    }
    if (g.fill !== undefined) out.fills.set(p, g.fill);
    if (g.hatch) out.hatches.push({ loops: [p.polygon.outer, ...p.polygon.holes] as Pt[][], pattern: g.hatch, scale: g.hatchScale ?? 1, pen: g.hatchPen ?? 'hairline' });
  }

  // Edges of every band, by material name, to find the boundaries inside one material and between layers.
  const index = new SegIndex<{ poly: DrawingPolygon; key: string }>();
  for (const { p, g } of named) if (g && !g.membrane) for (const e of edges(p)) index.add(e, { poly: p, key: g.name.trim().toLowerCase() });
  const cutLines = drawing.lines.filter((l) => l.category === 'cut');
  for (const line of cutLines) {
    const seg = { a: line.line.start, b: line.line.end };
    const touching = index.near(seg).filter((c) => coincide(seg, c.seg) || coincide(c.seg, seg));
    // Two elements' bands of one material meet along this line: it is inside the material.
    const byKey = new Map<string, Set<number>>();
    for (const c of touching) {
      const set = byKey.get(c.item.key) ?? new Set<number>();
      set.add(c.item.poly.entityId);
      byKey.set(c.item.key, set);
    }
    if ([...byKey.values()].some((entities) => entities.size > 1)) out.dropLines.add(line);
  }

  // Thin layers: on the interface between the layers either side of them.
  const byEntity = new Map<number, typeof named>();
  for (const n of named) {
    const list = byEntity.get(n.p.entityId) ?? [];
    list.push(n);
    byEntity.set(n.p.entityId, list);
  }
  for (const [entityId, polys] of byEntity) {
    const layers = r.layers(entityId, polys[0].p.modelIndex);
    if (!layers) continue;
    layers.forEach((layer, i) => {
      if (!r.membrane(layer) || layer.thickness >= 0.002 && polys.some((x) => x.p.materialId === layer.materialId)) return;
      const before = [...layers.slice(0, i)].reverse().find((l) => !r.membrane(l));
      const after = layers.slice(i + 1).find((l) => !r.membrane(l));
      if (!before || !after) return;
      const side = (l: LayerRef) => polys.filter((x) => x.p.materialId === l.materialId).flatMap((x) => edges(x.p));
      const a = side(before), b = side(after);
      for (const e of a) {
        if (!b.some((f) => coincide(e, f) || coincide(f, e))) continue;
        out.membranes.push({ type: 'line', a: e.a, b: e.b });
        for (const line of cutLines) if (line.entityId === entityId && (coincide(e, { a: line.line.start, b: line.line.end }) || coincide({ a: line.line.start, b: line.line.end }, e))) out.dropLines.add(line);
      }
    });
  }
  return out;
}
