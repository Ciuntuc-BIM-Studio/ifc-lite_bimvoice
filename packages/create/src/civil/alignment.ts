/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road's horizontal alignment, authored the way road designers do: a
 * chain of PIs (points of intersection of the tangents), each inner one
 * with a circular arc of radius R and, optionally, an entry and an exit
 * clothoid (Euler spiral, curvature proportional to length) of lengths
 * Ls1 / Ls2. The chain resolves to tangent-continuous segments — line,
 * spiral, arc, spiral, line … — that `pointAt(station)` evaluates:
 * position, direction (radians, counter-clockwise from +X) and curvature.
 *
 * Clothoid coordinates come from the Fresnel series; the spiral-arc-spiral
 * geometry at a PI is solved from the arc centre, which lies `R + p` off
 * each tangent (p the spiral's shift), so unequal spirals need no special
 * case. Stations are metres from the first PI plus `startStation`.
 * An alignment can instead be laid out entity by entity (`layout`).
 */

import {
  assembleAlignment, dist, roundCorner, wrap, type AlignmentPiece, type AlignmentPoint, type AlignmentSegment, type AlignmentSegmentKind, type HorizontalAlignment, type V2,
} from './alignment-geometry.js';
import { buildLayout, layoutFromPis, type LayoutEntity } from './alignment-layout.js';

export { clothoidPoint } from './alignment-geometry.js';
export type { AlignmentPoint, AlignmentSegment, AlignmentSegmentKind, HorizontalAlignment, V2 };

export interface AlignmentPI {
  x: number;
  y: number;
  /** Arc radius at this PI, metres; absent or 0 on the first / last PI and on a plain kink (refused: a kink has no tangent). */
  radius?: number;
  /** Entry spiral length, metres (0 / absent: none). */
  spiralIn?: number;
  /** Exit spiral length, metres (0 / absent: none). */
  spiralOut?: number;
}

export interface HorizontalAlignmentSpec {
  pis: AlignmentPI[];
  /** Station of the first PI, metres (0+000 by default). */
  startStation?: number;
  /**
   * Laid out as entities instead (Civil 3D style: fixed, floating and free
   * lines and curves, `alignment-layout.ts`); when present it is the
   * alignment, and `pis` only its outline.
   */
  layout?: LayoutEntity[];
}

/** Why the alignment cannot be built, or null. */
export function alignmentProblem(spec: HorizontalAlignmentSpec): string | null {
  try {
    buildAlignment(spec);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function buildAlignment(spec: HorizontalAlignmentSpec): HorizontalAlignment {
  if (spec.layout?.length) return buildLayout(spec.layout, spec.startStation ?? 0);
  const pis = spec.pis;
  if (pis.length < 2) throw new Error('An alignment needs at least two PIs');
  for (let i = 1; i < pis.length; i++) if (dist([pis[i - 1].x, pis[i - 1].y], [pis[i].x, pis[i].y]) < 1e-6) throw new Error(`PI ${i} coincides with PI ${i - 1}`);
  const pieces: AlignmentPiece[] = [];
  let cursor: V2 = [pis[0].x, pis[0].y];
  for (let i = 1; i < pis.length - 1; i++) {
    const prev: V2 = [pis[i - 1].x, pis[i - 1].y], at: V2 = [pis[i].x, pis[i].y], next: V2 = [pis[i + 1].x, pis[i + 1].y];
    const dIn = Math.atan2(at[1] - prev[1], at[0] - prev[0]);
    const dOut = Math.atan2(next[1] - at[1], next[0] - at[0]);
    const corner = roundCorner(dIn, at, dOut, pis[i].radius ?? 0, Math.max(0, pis[i].spiralIn ?? 0), Math.max(0, pis[i].spiralOut ?? 0), i, `PI ${i}`);
    if (!corner) continue;
    const u1: V2 = [Math.cos(dIn), Math.sin(dIn)], u2: V2 = [Math.cos(dOut), Math.sin(dOut)];
    const tangentIn = (at[0] - corner.ts[0]) * u1[0] + (at[1] - corner.ts[1]) * u1[1];
    const run = (corner.ts[0] - cursor[0]) * u1[0] + (corner.ts[1] - cursor[1]) * u1[1];
    if (run < -1e-6) throw new Error(`PI ${i}: its curve (tangent ${tangentIn.toFixed(2)} m) overlaps the previous one; reduce the radius or the spirals`);
    if (run > 1e-9) pieces.push({ kind: 'line', start: cursor, direction: dIn, length: run, radius: Infinity, turn: 1, pi: i });
    pieces.push(...corner.pieces);
    // The exact ST, so the next tangent starts clean.
    cursor = corner.st;
    const tangentOut = (next[0] - corner.st[0]) * u2[0] + (next[1] - corner.st[1]) * u2[1];
    if (tangentOut < -1e-6) throw new Error(`PI ${i}: its curve runs past PI ${i + 1}; reduce the radius or the spirals`);
  }
  const last: V2 = [pis[pis.length - 1].x, pis[pis.length - 1].y];
  const tail = dist(cursor, last);
  if (tail > 1e-9) pieces.push({ kind: 'line', start: cursor, direction: Math.atan2(last[1] - cursor[1], last[0] - cursor[0]), length: tail, radius: Infinity, turn: 1, pi: pis.length - 1 });
  return assembleAlignment(pieces, spec.startStation ?? 0);
}

/** The largest radius (no spirals) whose tangents fit between a PI's neighbours, with a little room to spare. */
export function fitRadius(prev: V2, at: V2, next: V2, wanted: number): number {
  const dIn = Math.atan2(at[1] - prev[1], at[0] - prev[0]);
  const dOut = Math.atan2(next[1] - at[1], next[0] - at[0]);
  const delta = Math.abs(wrap(dOut - dIn));
  if (delta < 1e-9) return 0;
  const room = Math.min(dist(prev, at), dist(at, next)) / 2 * 0.95;
  return Math.min(wanted, room / Math.tan(delta / 2));
}

/**
 * The alignment after its drawn polyline was edited: each vertex keeps its
 * PI's radius and spirals — matched by order when the polyline kept its
 * vertex count (a vertex moved), else by the nearest old PI (one added or
 * removed) — the radius made to fit where it no longer does; a new vertex
 * gets `radius`. A layout follows: points that sat on the old PIs move with
 * them, or, when vertices were added or removed, it is laid out anew from
 * the PIs.
 */
export function alignmentFollowingPolyline(old: HorizontalAlignmentSpec, points: readonly V2[], radius: number): HorizontalAlignmentSpec {
  const same = points.length === old.pis.length;
  const nearest = (p: V2) => old.pis.reduce<AlignmentPI | null>((best, q) => (!best || dist(p, [q.x, q.y]) < dist(p, [best.x, best.y]) ? q : best), null);
  const pis: AlignmentPI[] = points.map(([x, y], i) => {
    if (i === 0 || i === points.length - 1) return { x, y };
    const was = same ? old.pis[i] : nearest([x, y]);
    const r = fitRadius(points[i - 1], points[i], points[i + 1], was?.radius ?? radius);
    return r > 0 ? { x, y, radius: Math.round(r * 100) / 100, spiralIn: was?.spiralIn, spiralOut: was?.spiralOut } : { x, y };
  });
  if (!old.layout?.length) return { ...old, pis };
  if (!same) return { ...old, pis, layout: layoutFromPis(pis) };
  const moved = (p: V2): V2 => {
    const k = old.pis.findIndex((q) => dist(p, [q.x, q.y]) < 1e-6);
    return k < 0 ? p : [pis[k].x, pis[k].y];
  };
  const layout = old.layout.map((e): LayoutEntity => {
    if (e.kind === 'line' && e.constraint === 'fixed') return { ...e, a: moved(e.a), b: moved(e.b) };
    if (e.kind === 'line' && e.constraint === 'floating') return { ...e, through: moved(e.through) };
    return e;
  });
  return { ...old, pis, layout };
}

/** PIs from a drawn polyline, every inner vertex rounded with `radius` where it fits (smaller where not). */
export function alignmentFromPolyline(points: readonly V2[], radius: number, startStation = 0): HorizontalAlignmentSpec {
  const pis: AlignmentPI[] = points.map(([x, y]) => ({ x, y }));
  for (let i = 1; i < points.length - 1; i++) {
    const r = fitRadius(points[i - 1], points[i], points[i + 1], radius);
    if (r > 0) pis[i].radius = Math.round(r * 100) / 100;
  }
  return { pis, startStation };
}

/** Sample the whole alignment every `step` metres plus its critical stations. */
export function sampleAlignment(a: HorizontalAlignment, step: number): { station: number; point: AlignmentPoint }[] {
  const stations = new Set(a.criticalStations());
  for (let s = a.startStation; s < a.endStation; s += Math.max(step, 0.01)) stations.add(s);
  return [...stations].sort((x, y) => x - y).map((station) => ({ station, point: a.pointAt(station) }));
}

/** Station text, road style: 1234.5 → 1+234.50. */
export function formatStation(station: number): string {
  const km = Math.floor(station / 1000);
  const m = station - km * 1000;
  return `${km}+${m.toFixed(2).padStart(6, '0')}`;
}
