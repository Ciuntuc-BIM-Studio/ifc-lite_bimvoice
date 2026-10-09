/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The longitudinal profile drawing of a corridor, Civil 3D style: a grid
 * (stations across, elevations up, exaggerated vertically), the existing
 * ground and the design grade line, each PVI with its vertical curve and
 * the grades of the tangents, the elevation scale on the left, and the band
 * table underneath — station, ground and design elevations, cut / fill
 * depth, and the horizontal geometry (tangents, curves with their radius,
 * spirals). Drawing metres (`drawing-prims.ts`); x = station − start.
 */

import { formatStation } from './alignment.js';
import type { CorridorModel } from './corridor.js';
import { boundsOf, fmt, paper, type CivilDrawing, type DrawPrim, type P2 } from './drawing-prims.js';
import type { Terrain } from './tin.js';

export interface ProfileDrawingOptions {
  /** Drawing scale denominator (horizontal): 1000 = 1 : 1000. */
  scale: number;
  /** Vertical exaggeration (10: the vertical reads 1 : scale / 10). */
  vExaggeration: number;
  /** Grid and band column every this many metres of station. */
  stationStep: number;
  /** Elevation grid every this many metres. */
  elevationStep: number;
}

export interface ProfileDrawingLabels {
  title: string;
  station: string;
  ground: string;
  grade: string;
  cutFill: string;
  geometry: string;
  /** "L = {length} m". */
  curve: (length: string) => string;
  /** "R = {radius}". */
  radius: (radius: string) => string;
}

export const DEFAULT_PROFILE_OPTIONS: ProfileDrawingOptions = { scale: 1000, vExaggeration: 10, stationStep: 20, elevationStep: 1 };

export function profileDrawing(model: CorridorModel, terrain: Terrain | null, options: Partial<ProfileDrawingOptions>, labels: ProfileDrawingLabels): CivilDrawing {
  const o = { ...DEFAULT_PROFILE_OPTIONS, ...options };
  const a = model.alignment, p = model.profile;
  const s0 = a.startStation, s1 = a.endStation;
  const groundAt = (s: number): number | null => {
    if (!terrain) return null;
    const q = a.pointAt(s);
    return terrain.elevationAt(q.x, q.y);
  };
  const samples: number[] = [];
  for (let s = s0; s < s1; s += 2) samples.push(s);
  samples.push(s1);
  const grades = samples.map((s) => p.elevationAt(s));
  const grounds = samples.map(groundAt);
  const zs = [...grades, ...grounds.filter((z): z is number => z !== null)];
  const step = Math.max(o.elevationStep, 0.1);
  const datum = Math.floor((Math.min(...zs) - step) / step) * step;
  const top = Math.ceil((Math.max(...zs) + step) / step) * step;
  const X = (s: number) => s - s0;
  const Y = (z: number) => (z - datum) * o.vExaggeration;
  const mm = (v: number) => paper(v, o.scale);
  const prims: DrawPrim[] = [];
  const width = X(s1), height = Y(top);

  // Grid and frame.
  const sStep = Math.max(o.stationStep, 1);
  for (let s = Math.ceil(s0 / sStep) * sStep; s <= s1 + 1e-9; s += sStep) prims.push({ kind: 'line', a: [X(s), 0], b: [X(s), height], pen: 'grid' });
  for (let z = datum; z <= top + 1e-9; z += step) {
    prims.push({ kind: 'line', a: [0, Y(z)], b: [width, Y(z)], pen: 'grid' });
    prims.push({ kind: 'text', at: [-mm(1.5), Y(z) - mm(1)], text: fmt(z, 2), size: 2, anchor: 'end', pen: 'label' });
  }
  prims.push({ kind: 'poly', pts: [[0, 0], [width, 0], [width, height], [0, height]], closed: true, pen: 'frame' });
  prims.push({ kind: 'text', at: [width / 2, height + mm(4)], text: labels.title, size: 3.5, anchor: 'middle', pen: 'label' });

  // Ground and grade.
  let run: P2[] = [];
  grounds.forEach((z, i) => {
    if (z === null) { if (run.length > 1) prims.push({ kind: 'poly', pts: run, closed: false, pen: 'ground' }); run = []; return; }
    run.push([X(samples[i]), Y(z)]);
  });
  if (run.length > 1) prims.push({ kind: 'poly', pts: run, closed: false, pen: 'ground' });
  prims.push({ kind: 'poly', pts: samples.map((s, i) => [X(s), Y(grades[i])]), closed: false, pen: 'grade' });

  // PVIs, vertical curves and grades.
  const crit = p.criticalStations();
  const pvis = crit.filter((s) => s > s0 - 1e-9 && s < s1 + 1e-9);
  for (const s of pvis) {
    const z = p.elevationAt(s), g0 = p.gradeAt(s - 1e-6), g1 = p.gradeAt(s + 1e-6);
    if (Math.abs(g1 - g0) > 1e-9 || s === pvis[0] || s === pvis[pvis.length - 1]) {
      prims.push({ kind: 'line', a: [X(s), Y(z)], b: [X(s), Y(z) + mm(8)], pen: 'geometry' });
      prims.push({ kind: 'text', at: [X(s) + mm(0.8), Y(z) + mm(8)], text: `${formatStation(s)}  ${fmt(z, 2)}`, size: 1.8, anchor: 'start', pen: 'label', rotate: 90 });
    }
  }
  // A vertical curve: its chord marks (BVC … EVC) and its length, above the grade.
  for (let i = 0; i + 2 < crit.length; i++) {
    const [b, m, e] = [crit[i], crit[i + 1], crit[i + 2]];
    const curved = Math.abs(p.gradeAt(m) - p.gradeAt(b + 1e-6)) > 1e-9 && Math.abs(p.gradeAt(e - 1e-6) - p.gradeAt(m)) > 1e-9;
    if (!curved || m - b <= 1e-6 || Math.abs((m - b) - (e - m)) > 1e-6) continue;
    const yTop = Math.max(Y(p.elevationAt(b)), Y(p.elevationAt(e))) + mm(12);
    prims.push({ kind: 'line', a: [X(b), yTop], b: [X(e), yTop], pen: 'geometry' });
    prims.push({ kind: 'line', a: [X(b), yTop], b: [X(b), Y(p.elevationAt(b))], pen: 'geometry' });
    prims.push({ kind: 'line', a: [X(e), yTop], b: [X(e), Y(p.elevationAt(e))], pen: 'geometry' });
    prims.push({ kind: 'text', at: [X(m), yTop + mm(1)], text: labels.curve(fmt(e - b, 1)), size: 2, anchor: 'middle', pen: 'label' });
  }
  // Grades: on each constant-grade run, its percentage above the line.
  const breaks = [s0, ...crit.filter((s) => s > s0 && s < s1), s1];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const mid = (breaks[i] + breaks[i + 1]) / 2, g = p.gradeAt(mid);
    if (Math.abs(p.gradeAt(breaks[i] + 1e-6) - p.gradeAt(breaks[i + 1] - 1e-6)) > 1e-9) continue;
    if (X(breaks[i + 1]) - X(breaks[i]) < mm(15)) continue;
    prims.push({ kind: 'text', at: [X(mid), Y(p.elevationAt(mid)) + mm(1.5)], text: `${g >= 0 ? '+' : ''}${fmt(g * 100, 2)} %`, size: 2, anchor: 'middle', pen: 'label' });
  }

  // Band table.
  const rowH = mm(8), labelW = mm(28);
  const rows = [labels.station, labels.ground, labels.grade, labels.cutFill, labels.geometry];
  const bandTop = -mm(4);
  rows.forEach((label, r) => {
    const y = bandTop - r * rowH;
    prims.push({ kind: 'line', a: [-labelW, y], b: [width, y], pen: 'band' });
    prims.push({ kind: 'text', at: [-labelW + mm(1.5), y - rowH / 2 - mm(1)], text: label, size: 2.2, anchor: 'start', pen: 'label' });
  });
  const bandBottom = bandTop - rows.length * rowH;
  prims.push({ kind: 'line', a: [-labelW, bandBottom], b: [width, bandBottom], pen: 'band' });
  prims.push({ kind: 'line', a: [-labelW, bandTop], b: [-labelW, bandBottom], pen: 'band' });
  prims.push({ kind: 'line', a: [0, bandTop], b: [0, bandBottom], pen: 'band' });
  prims.push({ kind: 'line', a: [width, bandTop], b: [width, bandBottom], pen: 'band' });
  const columns = new Set<number>([s0, s1]);
  for (let s = Math.ceil(s0 / sStep) * sStep; s <= s1 + 1e-9; s += sStep) columns.add(Math.round(s * 1000) / 1000);
  const cols = [...columns].sort((x, y) => x - y).filter((s, i, all) => i === 0 || X(s) - X(all[i - 1]) >= mm(3) || s === s1);
  for (const s of cols) {
    const g = groundAt(s), z = p.elevationAt(s);
    const values = [formatStation(s), g === null ? '—' : fmt(g, 2), fmt(z, 2), g === null ? '—' : `${z - g >= 0 ? '+' : ''}${fmt(z - g, 2)}`];
    values.forEach((v, r) => {
      const y = bandTop - r * rowH - rowH + mm(1);
      prims.push({ kind: 'text', at: [X(s) + mm(0.7), y], text: v, size: 1.8, anchor: 'start', pen: 'label', rotate: 90 });
    });
    prims.push({ kind: 'line', a: [X(s), bandTop], b: [X(s), bandTop - rowH * 4], pen: 'band' });
  }
  // Horizontal geometry: tangents on the row's middle line, curves bumped toward their turn, spirals sloping between.
  const mid = bandTop - 4.5 * rowH, bump = rowH * 0.3;
  for (const seg of a.segments) {
    const x0 = X(seg.station), x1 = X(seg.station + seg.length);
    const lift = seg.kind === 'line' ? 0 : seg.turn * bump;
    if (seg.kind === 'spiralIn') prims.push({ kind: 'line', a: [x0, mid], b: [x1, mid + lift], pen: 'geometry' });
    else if (seg.kind === 'spiralOut') prims.push({ kind: 'line', a: [x0, mid + lift], b: [x1, mid], pen: 'geometry' });
    else {
      prims.push({ kind: 'line', a: [x0, mid + lift], b: [x1, mid + lift], pen: 'geometry' });
      if (seg.kind === 'arc' && x1 - x0 > mm(12)) prims.push({ kind: 'text', at: [(x0 + x1) / 2, mid + lift + (lift > 0 ? mm(0.8) : -mm(2.8))], text: labels.radius(fmt(seg.radius, 1)), size: 1.8, anchor: 'middle', pen: 'label' });
    }
  }
  return { prims, bounds: boundsOf(prims) };
}
