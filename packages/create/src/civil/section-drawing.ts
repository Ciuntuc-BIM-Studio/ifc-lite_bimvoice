/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cross-section drawings of a corridor, Civil 3D style ("section views"):
 * at each sample station a small grid (offsets across, elevations up, true
 * scale) with the existing ground, the pavement courses filled in their
 * colours, the daylight slopes, the components cut there (walls, tunnels,
 * decks…), the axis, the edge and daylight offsets and elevations, the
 * title station and the cut / fill areas; the sections are laid out in a
 * grid of `columns`, left to right, top to bottom. Drawing metres.
 */

import { formatStation } from './alignment.js';
import type { CorridorModel } from './corridor.js';
import { boundsOf, fmt, paper, translatePrims, type CivilDrawing, type DrawPrim, type P2 } from './drawing-prims.js';
import type { Terrain } from './tin.js';

export interface SectionDrawingOptions {
  /** Drawing scale denominator: 200 = 1 : 200. */
  scale: number;
  /** Sample every this many metres (when `stations` is empty). */
  every: number;
  /** Explicit stations; empty: every `every` metres from the start. */
  stations: number[];
  columns: number;
  /** Half the width shown either side of the axis, metres; 0: as wide as the daylight reaches. */
  halfWidth: number;
}

export interface SectionDrawingLabels {
  /** "Cut {cut} m² · Fill {fill} m²". */
  areas: (cut: string, fill: string) => string;
}

export const DEFAULT_SECTION_OPTIONS: SectionDrawingOptions = { scale: 200, every: 20, stations: [], columns: 3, halfWidth: 0 };

/** The stations a section set shows. */
export function sampleStations(model: CorridorModel, o: Pick<SectionDrawingOptions, 'every' | 'stations'>): number[] {
  const a = model.alignment;
  if (o.stations.length) return [...new Set(o.stations.filter((s) => s >= a.startStation - 1e-9 && s <= a.endStation + 1e-9))].sort((x, y) => x - y);
  const step = Math.max(o.every, 1);
  const out: number[] = [];
  for (let s = Math.ceil(a.startStation / step) * step; s <= a.endStation + 1e-9; s += step) out.push(Math.round(s * 1000) / 1000);
  if (!out.length || out[0] - a.startStation > 1e-6) out.unshift(a.startStation);
  return out;
}

/** One section view, its datum line at y = 0 and the axis at x = 0. */
export function oneSection(model: CorridorModel, terrain: Terrain | null, station: number, o: SectionDrawingOptions, labels: SectionDrawingLabels, courses: { color: string; thickness: number }[]): CivilDrawing {
  const st = model.sectionAt(station);
  const right: [number, number] = [Math.sin(st.direction), -Math.cos(st.direction)];
  const off = (q: readonly number[]) => (q[0] - st.origin[0]) * right[0] + (q[1] - st.origin[1]) * right[1];
  const top: P2[] = st.top.map((q) => [off(q), q[2]]);
  const dl: P2 | null = st.daylightLeft ? [off(st.daylightLeft), st.daylightLeft[2]] : null;
  const dr: P2 | null = st.daylightRight ? [off(st.daylightRight), st.daylightRight[2]] : null;
  const comps = model.componentsAt(station);
  const reach = Math.max(Math.abs(dl?.[0] ?? top[0][0]), Math.abs(dr?.[0] ?? top[top.length - 1][0]), ...comps.flatMap((c) => c.loops.flat().map((p) => Math.abs(p[0]))));
  const half = o.halfWidth > 0 ? o.halfWidth : Math.ceil((reach + 3) / 5) * 5;
  const ground: P2[] = [];
  if (terrain) {
    for (let x = -half; x <= half + 1e-9; x += half / 60) {
      const z = terrain.elevationAt(st.origin[0] + right[0] * x, st.origin[1] + right[1] * x);
      if (z !== null) ground.push([x, z]);
    }
  }
  const depth = courses.reduce((s, c) => s + c.thickness, 0);
  const zs = [...top.map((p) => p[1]), ...top.map((p) => p[1] - depth), ...ground.map((p) => p[1]), ...comps.flatMap((c) => c.loops.flat().map((p) => p[1])), ...(dl ? [dl[1]] : []), ...(dr ? [dr[1]] : [])];
  const datum = Math.floor(Math.min(...zs)) - 1;
  const ceil = Math.ceil(Math.max(...zs)) + 1;
  const Y = (z: number) => z - datum;
  const mm = (v: number) => paper(v, o.scale);
  const prims: DrawPrim[] = [];
  // Grid: every 5 m across, every metre up.
  for (let x = -half; x <= half + 1e-9; x += 5) prims.push({ kind: 'line', a: [x, 0], b: [x, Y(ceil)], pen: 'grid' });
  for (let z = datum; z <= ceil + 1e-9; z += 1) {
    prims.push({ kind: 'line', a: [-half, Y(z)], b: [half, Y(z)], pen: 'grid' });
    prims.push({ kind: 'text', at: [-half - mm(1), Y(z) - mm(0.8)], text: fmt(z, 1), size: 1.6, anchor: 'end', pen: 'label' });
  }
  prims.push({ kind: 'poly', pts: [[-half, 0], [half, 0], [half, Y(ceil)], [-half, Y(ceil)]], closed: true, pen: 'frame' });
  prims.push({ kind: 'line', a: [0, 0], b: [0, Y(ceil)], pen: 'axis' });
  // Courses, top first.
  let above = 0;
  for (const c of courses) {
    const below = above + c.thickness;
    const ring: P2[] = [...top.map((p): P2 => [p[0], Y(p[1] - above)]), ...[...top].reverse().map((p): P2 => [p[0], Y(p[1] - below)])];
    prims.push({ kind: 'poly', pts: ring, closed: true, pen: 'course', fill: c.color });
    above = below;
  }
  for (const c of comps) for (const loop of c.loops) prims.push({ kind: 'poly', pts: loop.map((p): P2 => [p[0], Y(p[1])]), closed: true, pen: 'component', fill: c.color });
  if (dl) prims.push({ kind: 'line', a: [top[0][0], Y(top[0][1])], b: [dl[0], Y(dl[1])], pen: 'daylight' });
  if (dr) prims.push({ kind: 'line', a: [top[top.length - 1][0], Y(top[top.length - 1][1])], b: [dr[0], Y(dr[1])], pen: 'daylight' });
  if (ground.length > 1) prims.push({ kind: 'poly', pts: ground.map((p): P2 => [p[0], Y(p[1])]), closed: false, pen: 'ground' });
  // Offsets and elevations at the axis, the road edges and the daylight points.
  const marks: P2[] = [top[0], [0, st.origin[2]], top[top.length - 1], ...(dl ? [dl] : []), ...(dr ? [dr] : [])];
  for (const [x, z] of marks) prims.push({ kind: 'text', at: [x, Y(z) + mm(1)], text: `${fmt(x, 2)} / ${fmt(z, 2)}`, size: 1.5, anchor: 'start', pen: 'label', rotate: 90 });
  prims.push({ kind: 'text', at: [0, Y(ceil) + mm(2)], text: formatStation(station), size: 3, anchor: 'middle', pen: 'label' });
  prims.push({ kind: 'text', at: [0, -mm(4)], text: labels.areas(fmt(st.cutArea, 2), fmt(st.fillArea, 2)), size: 2, anchor: 'middle', pen: 'label' });
  return { prims, bounds: boundsOf(prims) };
}

/** The section set laid out in a grid (each cell as wide / tall as its largest section). */
export function sectionsDrawing(model: CorridorModel, terrain: Terrain | null, options: Partial<SectionDrawingOptions>, labels: SectionDrawingLabels, courses: { color: string; thickness: number }[]): CivilDrawing {
  const o = { ...DEFAULT_SECTION_OPTIONS, ...options };
  const views = sampleStations(model, o).map((s) => oneSection(model, terrain, s, o, labels, courses));
  if (views.length === 0) return { prims: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
  const cols = Math.max(1, Math.round(o.columns));
  const w = Math.max(...views.map((v) => v.bounds.maxX - v.bounds.minX)) + paper(10, o.scale);
  const h = Math.max(...views.map((v) => v.bounds.maxY - v.bounds.minY)) + paper(10, o.scale);
  const prims: DrawPrim[] = [];
  views.forEach((v, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    // Each view centred in its cell, rows going down.
    const dx = col * w + w / 2 - (v.bounds.minX + v.bounds.maxX) / 2;
    const dy = -row * h - h / 2 - (v.bounds.minY + v.bounds.maxY) / 2;
    prims.push(...translatePrims(v.prims, dx, dy));
  });
  return { prims, bounds: boundsOf(prims) };
}
