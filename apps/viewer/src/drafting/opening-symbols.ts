/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Plan symbols for doors and windows, as a floor plan shows them: a door
 * as its leaf drawn open at 90° with the swing arc, a window as its frame
 * with the glazing line. A plan cut through a door otherwise shows only
 * the gap in the wall (and whatever slice of the leaf the cut catches).
 *
 * Read from the geometry, so it works for any model, authored or loaded:
 * each door / window mesh the plan's cut passes through is projected onto
 * the drawing, and the minimum-area rectangle around that footprint gives
 * the opening — its long side the width, its short side the wall depth.
 * The swing side is not in the mesh; it defaults to one side consistently
 * (the drawing's +x / +y normal), until the element says otherwise.
 */

import type { MeshData } from '@ifc-lite/geometry';
import type { SectionPlaneConfig } from '@ifc-lite/drawing-2d';
import type { JoinerySpec } from '@ifc-lite/create';
import { typedPlanSymbol } from '@/joinery/plan-placement';
import { worldToDrawing } from './frame';
import type { DraftShape, Pt } from './types';

export interface OpeningRect {
  c: Pt;
  /** Unit vector along the width. */
  u: Pt;
  /** Unit normal (across the wall). */
  n: Pt;
  width: number;
  depth: number;
}

const crossO = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function hull(points: Pt[]): Pt[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const half = (list: Pt[]) => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && crossO(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/** The minimum-area rectangle around `points` (rotating the hull's edges), or null when degenerate. */
export function minAreaRect(points: Pt[]): OpeningRect | null {
  const h = hull(points);
  if (h.length < 3) return null;
  let best: { area: number; rect: OpeningRect } | null = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -u.y, y: u.x };
    let minU = Infinity, maxU = -Infinity, minN = Infinity, maxN = -Infinity;
    for (const p of h) {
      const pu = p.x * u.x + p.y * u.y, pn = p.x * n.x + p.y * n.y;
      minU = Math.min(minU, pu); maxU = Math.max(maxU, pu);
      minN = Math.min(minN, pn); maxN = Math.max(maxN, pn);
    }
    const area = (maxU - minU) * (maxN - minN);
    if (best && area >= best.area) continue;
    const cu = (minU + maxU) / 2, cn = (minN + maxN) / 2;
    const c = { x: u.x * cu + n.x * cn, y: u.y * cu + n.y * cn };
    // Width along the longer side.
    const along = maxU - minU >= maxN - minN;
    best = {
      area,
      rect: along
        ? { c, u, n, width: maxU - minU, depth: maxN - minN }
        : { c, u: n, n: { x: -n.y, y: n.x }, width: maxN - minN, depth: maxU - minU },
    };
  }
  if (!best || best.rect.width < 1e-6) return null;
  // One consistent orientation: u toward +x (or +y), n its left normal.
  const r = best.rect;
  if (r.u.x < -1e-9 || (Math.abs(r.u.x) <= 1e-9 && r.u.y < 0)) {
    r.u = { x: -r.u.x, y: -r.u.y };
  }
  r.n = { x: -r.u.y, y: r.u.x };
  return r;
}

const at = (r: OpeningRect, su: number, sn: number): Pt => ({
  x: r.c.x + r.u.x * su + r.n.x * sn,
  y: r.c.y + r.u.y * su + r.n.y * sn,
});

/**
 * A door: leaf open at 90° and its swing arc. By default hinged on the −u
 * jamb and swinging to the +n side; `flips` bit 1 hinges it on the other
 * jamb, bit 2 swings it to the other side.
 */
export function doorSymbol(r: OpeningRect, flips = 0): DraftShape[] {
  const sh = flips & 1 ? 1 : -1;
  const sn = flips & 2 ? -1 : 1;
  const hinge = at(r, sh * r.width / 2, sn * r.depth / 2);
  const leaf = { x: r.n.x * sn, y: r.n.y * sn };
  const jamb = { x: -r.u.x * sh, y: -r.u.y * sh };
  const tip = { x: hinge.x + leaf.x * r.width, y: hinge.y + leaf.y * r.width };
  const a = Math.atan2(jamb.y, jamb.x);
  const b = Math.atan2(leaf.y, leaf.x);
  // The quarter turn between the closed and the open leaf, counter-clockwise.
  const ccw = jamb.x * leaf.y - jamb.y * leaf.x > 0;
  return [
    { type: 'line', a: hinge, b: tip },
    { type: 'arc', c: hinge, r: r.width, start: ccw ? a : b, end: ccw ? b : a },
  ];
}

/** A window: its frame across the wall and the glazing line along the middle. */
export function windowSymbol(r: OpeningRect): DraftShape[] {
  const w = r.width / 2, d = r.depth / 2;
  return [
    { type: 'polyline', pts: [at(r, -w, -d), at(r, w, -d), at(r, w, d), at(r, -w, d)], closed: true },
    { type: 'line', a: at(r, -w, 0), b: at(r, w, 0) },
  ];
}

export interface OpeningSymbol {
  /** The element's mesh id (the renderer's global id). */
  id: number;
  kind: 'door' | 'window';
  /** Thin lines (all of a symbol read from the mesh). */
  shapes: DraftShape[];
  /** A configured type's cut parts (frame, sashes), drawn heavy. */
  heavy?: DraftShape[];
  dashed?: DraftShape[];
}

/** Every shape of a symbol, whatever its weight. */
export const symbolShapes = (s: OpeningSymbol): DraftShape[] => [...s.shapes, ...(s.heavy ?? []), ...(s.dashed ?? [])];

const KIND: Record<string, 'door' | 'window'> = { IFCDOOR: 'door', IFCDOORSTANDARDCASE: 'door', IFCWINDOW: 'window', IFCWINDOWSTANDARDCASE: 'window' };

/**
 * The door and window symbols of a plan cut at `plane` (a horizontal plane,
 * world units): every door / window whose meshes the cut height passes
 * through. Meshes of one element are taken together.
 */
export function openingSymbols(
  meshes: readonly MeshData[], plane: SectionPlaneConfig, flipsOf: (id: number) => number = () => 0,
  typedOf: (id: number) => { spec: JoinerySpec; flips: number } | null = () => null,
): OpeningSymbol[] {
  if (plane.axis !== 'y' || plane.customPlane) return [];
  const cut = plane.position;
  const byId = new Map<number, { kind: 'door' | 'window'; pts: Pt[]; minY: number; maxY: number; world: number[]; l2w?: number[] }>();
  for (const mesh of meshes) {
    const kind = KIND[(mesh.ifcType ?? '').toUpperCase()];
    if (!kind || (mesh.geometryClass ?? 0) === 2) continue;
    // World = the mesh's local-frame origin + its positions.
    const [ox, oy, oz] = mesh.origin ?? [0, 0, 0];
    const entry = byId.get(mesh.expressId) ?? { kind, pts: [], minY: Infinity, maxY: -Infinity, world: [] };
    entry.l2w ??= mesh.localToWorld;
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      const y = oy + p[i + 1];
      entry.minY = Math.min(entry.minY, y);
      entry.maxY = Math.max(entry.maxY, y);
      entry.pts.push(worldToDrawing(plane, { x: ox + p[i], y, z: oz + p[i + 2] }));
      entry.world.push(ox + p[i], y, oz + p[i + 2]);
    }
    byId.set(mesh.expressId, entry);
  }
  const out: OpeningSymbol[] = [];
  for (const [id, entry] of byId) {
    if (cut < entry.minY || cut > entry.maxY) continue;
    const configured = entry.l2w ? typedOf(id) : null;
    const typed = configured && entry.l2w ? typedPlanSymbol(configured.spec, entry.world, entry.l2w, plane, configured.flips) : null;
    if (typed) {
      out.push({ id, kind: entry.kind, shapes: typed.thin, heavy: typed.heavy, dashed: typed.dashed });
      continue;
    }
    const rect = minAreaRect(entry.pts);
    if (!rect) continue;
    out.push({ id, kind: entry.kind, shapes: entry.kind === 'door' ? doorSymbol(rect, flipsOf(id)) : windowSymbol(rect) });
  }
  return out;
}
