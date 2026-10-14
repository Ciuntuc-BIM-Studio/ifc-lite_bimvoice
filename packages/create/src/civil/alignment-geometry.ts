/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The geometry horizontal alignments are made of, however they are laid
 * out (`alignment.ts`, a PI chain; `alignment-layout.ts`, Civil 3D style
 * entities): lines, circular arcs and clothoids (Euler spirals, curvature
 * proportional to length; coordinates from the Fresnel series), a corner
 * rounded by spiral-arc-spiral, and the chaining of pieces by station.
 */

export type V2 = [number, number];

export type AlignmentSegmentKind = 'line' | 'arc' | 'spiralIn' | 'spiralOut';

export interface AlignmentSegment {
  kind: AlignmentSegmentKind;
  /** Station at the segment's start. */
  station: number;
  length: number;
  start: V2;
  /** Direction at the start, radians CCW from +X. */
  direction: number;
  /** Radius of the arc it belongs to (Infinity for a line). */
  radius: number;
  /** +1 turning left (CCW), -1 turning right. */
  turn: 1 | -1;
  /** The PI the segment belongs to (lines: the PI it runs toward). */
  pi: number;
}

export interface AlignmentPoint {
  x: number;
  y: number;
  /** Radians CCW from +X. */
  direction: number;
  /** Signed, 1/m: positive turning left. */
  curvature: number;
}

export interface HorizontalAlignment {
  segments: AlignmentSegment[];
  startStation: number;
  endStation: number;
  length: number;
  pointAt(station: number): AlignmentPoint;
  /** Segment boundaries (TS, SC, CS, ST…), stations, start and end included. */
  criticalStations(): number[];
}

const TWO_PI = Math.PI * 2;
export const wrap = (a: number) => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

/** Clothoid of length L reaching radius R: local coordinates at l along it (x forward, y toward the turn). */
export function clothoidPoint(l: number, R: number, L: number): V2 {
  if (R === Infinity || L <= 0) return [l, 0];
  const a = 2 * R * L;
  let x = 0, y = 0, fact = 1;
  for (let k = 0; k < 7; k++) {
    const sign = k % 2 === 0 ? 1 : -1;
    const f2k = fact;
    x += sign * Math.pow(l, 4 * k + 1) / ((4 * k + 1) * f2k * Math.pow(a, 2 * k));
    const f2k1 = f2k * (2 * k + 1);
    y += sign * Math.pow(l, 4 * k + 3) / ((4 * k + 3) * f2k1 * Math.pow(a, 2 * k + 1));
    fact = f2k1 * (2 * k + 2);
  }
  return [x, y];
}

/** A spiral's shift p and tangent offset k against the arc it leads into. */
function spiralShift(R: number, L: number): { p: number; k: number; theta: number } {
  if (L <= 0) return { p: 0, k: 0, theta: 0 };
  const theta = L / (2 * R);
  const [xs, ys] = clothoidPoint(L, R, L);
  return { p: ys - R * (1 - Math.cos(theta)), k: xs - R * Math.sin(theta), theta };
}

export const rot = (p: V2, a: number): V2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
export const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
export const scale = (a: V2, s: number): V2 => [a[0] * s, a[1] * s];
export const dist = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Evaluate one segment `l` metres into it. */
export function evalSegment(seg: AlignmentSegment, l: number): AlignmentPoint {
  const { start, direction: d, radius: R, turn, length: L } = seg;
  if (seg.kind === 'line') return { x: start[0] + Math.cos(d) * l, y: start[1] + Math.sin(d) * l, direction: d, curvature: 0 };
  if (seg.kind === 'arc') {
    const c = turn / R;
    const a = d + c * l;
    return { x: start[0] + (Math.sin(a) - Math.sin(d)) / c, y: start[1] - (Math.cos(a) - Math.cos(d)) / c, direction: a, curvature: c };
  }
  if (seg.kind === 'spiralIn') {
    const [x, y] = clothoidPoint(l, R, L);
    const p = add(start, rot([x, y * turn], d));
    return { x: p[0], y: p[1], direction: d + turn * l * l / (2 * R * L), curvature: turn * l / (R * L) };
  }
  // Spiral out: the entry spiral run backwards from its far end (curvature sign flips on reversal).
  const endDir = d + turn * L / (2 * R);
  const [xs, ys] = clothoidPoint(L, R, L);
  const disp = rot([xs, -ys * turn], endDir + Math.PI);
  const st: V2 = [start[0] - disp[0], start[1] - disp[1]];
  const back = evalSegment({ ...seg, kind: 'spiralIn', start: st, direction: endDir + Math.PI, turn: (-turn) as 1 | -1 }, L - l);
  return { x: back.x, y: back.y, direction: back.direction + Math.PI, curvature: -back.curvature };
}


/** One piece of an alignment before it is given its station. */
export type AlignmentPiece = Omit<AlignmentSegment, 'station'>;

/**
 * The curve rounding the corner where a tangent in direction `dIn` meets
 * one leaving in `dOut` at `at`: an arc of radius R, with an entry and an
 * exit clothoid of lengths L1 / L2, its centre R + p off each tangent (p the
 * spiral's shift). Null when the tangents run straight on. `ts` and `st`
 * are where it leaves and rejoins the tangents.
 */
export function roundCorner(dIn: number, at: V2, dOut: number, R: number, L1: number, L2: number, pi: number, label: string): { ts: V2; st: V2; pieces: AlignmentPiece[] } | null {
  const delta = wrap(dOut - dIn);
  if (Math.abs(delta) < 1e-9) return null;
  if (!(R > 0)) throw new Error(`${label} turns ${(Math.abs(delta) * 180 / Math.PI).toFixed(1)}° but has no radius`);
  const turn: 1 | -1 = delta > 0 ? 1 : -1;
  const s1 = spiralShift(R, L1), s2 = spiralShift(R, L2);
  const arcAngle = Math.abs(delta) - s1.theta - s2.theta;
  if (arcAngle < -1e-9) throw new Error(`${label}: the spirals turn more than the ${(Math.abs(delta) * 180 / Math.PI).toFixed(1)}° deflection`);
  // The arc centre lies R + p off each tangent, on the inside of the turn.
  const u1: V2 = [Math.cos(dIn), Math.sin(dIn)], u2: V2 = [Math.cos(dOut), Math.sin(dOut)];
  const n1: V2 = [-u1[1] * turn, u1[0] * turn], n2: V2 = [-u2[1] * turn, u2[0] * turn];
  const det = n1[0] * n2[1] - n1[1] * n2[0];
  const c1 = R + s1.p, c2 = R + s2.p;
  const centre: V2 = [at[0] + (c1 * n2[1] - c2 * n1[1]) / det, at[1] + (c2 * n1[0] - c1 * n2[0]) / det];
  const ts = add(add(centre, scale(u1, -s1.k)), scale(n1, -c1));
  const st = add(add(centre, scale(u2, s2.k)), scale(n2, -c2));
  const pieces: AlignmentPiece[] = [];
  let cursor = ts;
  const push = (kind: AlignmentSegmentKind, start: V2, direction: number, length: number) => {
    const piece: AlignmentPiece = { kind, length, start, direction, radius: R, turn, pi };
    pieces.push(piece);
    const end = evalSegment({ ...piece, station: 0 }, length);
    cursor = [end.x, end.y];
  };
  if (L1 > 0) push('spiralIn', ts, dIn, L1);
  const arcDir = dIn + turn * s1.theta;
  if (arcAngle > 1e-9) push('arc', cursor, arcDir, R * arcAngle);
  if (L2 > 0) push('spiralOut', cursor, arcDir + turn * arcAngle, L2);
  return { ts, st, pieces };
}

/** Chain pieces into an alignment: stations from `startStation`, evaluated by station. */
export function assembleAlignment(pieces: readonly AlignmentPiece[], startStation: number): HorizontalAlignment {
  const segments: AlignmentSegment[] = [];
  let station = startStation;
  for (const piece of pieces) {
    if (piece.length <= 1e-9) continue;
    segments.push({ ...piece, station });
    station += piece.length;
  }
  if (segments.length === 0) throw new Error('The alignment has no length');
  const endStation = station;
  const pointAt = (s: number): AlignmentPoint => {
    const clamped = Math.min(Math.max(s, startStation), endStation);
    let seg = segments[segments.length - 1];
    for (const candidate of segments) if (clamped <= candidate.station + candidate.length + 1e-9) { seg = candidate; break; }
    return evalSegment(seg, Math.min(Math.max(clamped - seg.station, 0), seg.length));
  };
  return {
    segments, startStation, endStation, length: endStation - startStation, pointAt,
    criticalStations: () => [...new Set([startStation, ...segments.map((g) => g.station), endStation])].sort((a, b) => a - b),
  };
}
