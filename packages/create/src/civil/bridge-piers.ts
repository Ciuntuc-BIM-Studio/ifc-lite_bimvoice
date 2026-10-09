/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A bridge's intermediate piers and its bearings, as closed solids and as
 * cuts by a cross-section.
 *
 * A pier stands square across the alignment at its station. A wall pier is
 * one blade; a column pier is a row of round or square columns under a pier
 * cap. Its top sits under the deck's soffit, less the bearings' height. It
 * reaches down to a metre under the ground on the axis, or to its own
 * height, onto a continuous footing.
 *
 * The bearings are a line of pads across under the deck at every support:
 * on each abutment's seat (between the front face and the back wall) and on
 * each pier's top. They are spread over the width of the deck's soffit.
 */

import type { HorizontalAlignment } from './alignment.js';
import type { VerticalProfile } from './profile.js';
import { bearingHeight, deckDepthOf, extrudeOutline, seatLength, soffitAt, type CorridorBridge, type ExtrudedSolid, type PierSpec, type PlacedAbutment } from './bridge.js';
import type { P2 } from './structure-profile.js';
import type { Terrain, V3 } from './tin.js';

/** A station's frame: the axis point (at z 0), along the road, to its right. */
export interface AxisFrame {
  o: V3;
  t: V3;
  r: V3;
}

export function frameAt(alignment: HorizontalAlignment, station: number): AxisFrame {
  const p = alignment.pointAt(station);
  return { o: [p.x, p.y, 0], t: [Math.cos(p.direction), Math.sin(p.direction), 0], r: [Math.sin(p.direction), -Math.cos(p.direction), 0] };
}

const UP: V3 = [0, 0, 1];

/** A box in a frame: along [a0, a1], across [c0, c1], up [z0, z1]. */
export function box(f: AxisFrame, a0: number, a1: number, c0: number, c1: number, z0: number, z1: number): ExtrudedSolid {
  return extrudeOutline([[a0, z0], [a1, z0], [a1, z1], [a0, z1]], f.o, f.t, UP, f.r, c0, c1);
}

/** A vertical prism of a plan outline (along, across) from z0 to z1. */
export function prism(f: AxisFrame, outline: readonly P2[], z0: number, z1: number): ExtrudedSolid {
  return extrudeOutline(outline, f.o, f.t, f.r, UP, z0, z1);
}

/** Several shells as one solid. */
export function mergeSolids(parts: readonly ExtrudedSolid[]): ExtrudedSolid {
  const points: V3[] = [];
  const triangles: [number, number, number][] = [];
  for (const s of parts) {
    const base = points.length;
    points.push(...s.points);
    for (const [a, b, c] of s.triangles) triangles.push([base + a, base + b, base + c]);
  }
  return { points, triangles };
}

const ROUND_SIDES = 16;

export interface PlacedPier {
  spec: PierSpec;
  /** Top (under the bearings) and bottom (the footing's top), elevations. */
  top: number;
  bottom: number;
  /** The columns' offsets across (a wall pier: none). */
  columns: number[];
}

/** Where a bridge's piers stand: their top under the deck, their bottom under the ground. */
export function placePiers(bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null): PlacedPier[] {
  const lo = Math.min(bridge.from, bridge.to), hi = Math.max(bridge.from, bridge.to);
  return (bridge.piers ?? []).filter((p) => p.station > lo && p.station < hi).map((spec) => {
    const top = soffitAt(bridge, profile, spec.station) - bearingHeight(bridge);
    const f = frameAt(alignment, spec.station);
    const ground = terrain?.elevationAt(f.o[0], f.o[1]) ?? null;
    const auto = spec.autoHeight ?? true;
    const bottom = Math.min(auto && ground !== null ? ground - 1 : top - Math.max(spec.height, 0.5), top - 0.5 - (spec.type === 'columns' ? spec.cap.depth : 0));
    const n = spec.type === 'columns' ? Math.max(1, Math.round(spec.columns)) : 0;
    const c0 = -spec.left + spec.thickness / 2, c1 = spec.right - spec.thickness / 2;
    const columns = n === 1 ? [(spec.right - spec.left) / 2] : Array.from({ length: n }, (_, i) => c0 + ((c1 - c0) * i) / (n - 1));
    return { spec, top, bottom, columns };
  });
}

const footingWidth = (p: PierSpec) => Math.max(p.footing.width, p.thickness, p.type === 'columns' ? p.cap.width : 0);

export interface PierSolids {
  stem: ExtrudedSolid;
  cap: ExtrudedSolid | null;
  footing: ExtrudedSolid;
}

export function pierSolids(pl: PlacedPier, alignment: HorizontalAlignment): PierSolids {
  const s = pl.spec, f = frameAt(alignment, s.station), h = s.thickness / 2;
  const capBottom = s.type === 'columns' ? pl.top - Math.max(s.cap.depth, 0.2) : pl.top;
  const column = (c: number): P2[] => (s.shape === 'round'
    ? Array.from({ length: ROUND_SIDES }, (_, i) => [h * Math.cos((2 * Math.PI * i) / ROUND_SIDES), c + h * Math.sin((2 * Math.PI * i) / ROUND_SIDES)] as P2)
    : [[-h, c - h], [h, c - h], [h, c + h], [-h, c + h]]);
  const stem = s.type === 'wall' ? box(f, -h, h, -s.left, s.right, pl.bottom, pl.top) : mergeSolids(pl.columns.map((c) => prism(f, column(c), pl.bottom, capBottom)));
  const cap = s.type === 'columns' ? box(f, -s.cap.width / 2, s.cap.width / 2, -s.left, s.right, capBottom, pl.top) : null;
  const fw = footingWidth(s) / 2;
  return { stem, cap, footing: box(f, -fw, fw, -s.left - 0.3, s.right + 0.3, pl.bottom - Math.max(s.footing.thickness, 0.2), pl.bottom) };
}

/** A support's line of bearings: its station, along offset of the line, the pads' bottom. */
export interface BearingLine {
  station: number;
  along: number;
  z: number;
}

export function bearingLines(start: PlacedAbutment, end: PlacedAbutment, piers: readonly PlacedPier[]): BearingLine[] {
  const seat = (pl: PlacedAbutment): BearingLine => ({ station: pl.station, along: (pl.back * seatLength(pl)) / 2, z: pl.seat });
  return [seat(start), ...piers.map((p) => ({ station: p.spec.station, along: 0, z: p.top })), seat(end)];
}

/** The pads' offsets across: spread over the deck's soffit. */
export function bearingOffsets(bridge: CorridorBridge): number[] {
  const b = bridge.bearings;
  if (!b || b.count < 1) return [];
  const minY = deckDepthOf(bridge).minY;
  const xs = bridge.deck.profile.outer.filter((q) => q[1] < minY + 1e-6).map((q) => q[0] + bridge.deck.offset[0]);
  const a = Math.min(...xs), z = Math.max(...xs);
  const n = Math.round(b.count);
  if (n === 1 || z - a < 1e-6) return [(a + z) / 2];
  const inset = Math.min(Math.max(b.width / 2 + 0.2, (z - a) * 0.1), (z - a) / 2);
  return Array.from({ length: n }, (_, i) => a + inset + ((z - a - 2 * inset) * i) / (n - 1));
}

export function bearingSolid(bridge: CorridorBridge, line: BearingLine, alignment: HorizontalAlignment): ExtrudedSolid | null {
  const b = bridge.bearings;
  const offsets = bearingOffsets(bridge);
  if (!b || !offsets.length) return null;
  const f = frameAt(alignment, line.station), l = b.length / 2, w = b.width / 2, h = bearingHeight(bridge);
  return mergeSolids(offsets.map((c) => box(f, line.along - l, line.along + l, c - w, c + w, line.z, line.z + h)));
}

/** Where a polygon crosses the vertical line x: the [y0, y1] intervals inside it. */
export function verticalCut(loop: readonly P2[], x: number): [number, number][] {
  const ys: number[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    if ((a[0] <= x) !== (b[0] <= x)) ys.push(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
  }
  ys.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-9) out.push([ys[i], ys[i + 1]]);
  return out;
}

/** A rectangle in a cross-section: across [c0, c1], elevations [z0, z1]. */
export const rect = (c0: number, c1: number, z0: number, z1: number): P2[] => [[c0, z0], [c1, z0], [c1, z1], [c0, z1]];

/** A pier cut at a station (d metres past its own): its stem (columns), cap and footing loops across. */
export function pierCut(pl: PlacedPier, d: number): { stem: P2[][]; cap: P2[][]; footing: P2[][] } {
  const s = pl.spec, h = s.thickness / 2;
  const capBottom = s.type === 'columns' ? pl.top - Math.max(s.cap.depth, 0.2) : pl.top;
  const stem: P2[][] = [];
  if (Math.abs(d) < h) {
    if (s.type === 'wall') stem.push(rect(-s.left, s.right, pl.bottom, pl.top));
    else for (const c of pl.columns) {
      const w = s.shape === 'round' ? Math.sqrt(h * h - d * d) : h;
      stem.push(rect(c - w, c + w, pl.bottom, capBottom));
    }
  }
  const cap = s.type === 'columns' && Math.abs(d) < s.cap.width / 2 ? [rect(-s.left, s.right, capBottom, pl.top)] : [];
  const footing = Math.abs(d) < footingWidth(s) / 2 ? [rect(-s.left - 0.3, s.right + 0.3, pl.bottom - Math.max(s.footing.thickness, 0.2), pl.bottom)] : [];
  return { stem, cap, footing };
}
