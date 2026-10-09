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
 */

export type V2 = [number, number];

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
}

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
const wrap = (a: number) => ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

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

const rot = (p: V2, a: number): V2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: V2, s: number): V2 => [a[0] * s, a[1] * s];
const dist = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Evaluate one segment `l` metres into it. */
function evalSegment(seg: AlignmentSegment, l: number): AlignmentPoint {
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

/** Why the chain cannot be built, or null. */
export function alignmentProblem(spec: HorizontalAlignmentSpec): string | null {
  try {
    buildAlignment(spec);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function buildAlignment(spec: HorizontalAlignmentSpec): HorizontalAlignment {
  const pis = spec.pis;
  if (pis.length < 2) throw new Error('An alignment needs at least two PIs');
  for (let i = 1; i < pis.length; i++) if (dist([pis[i - 1].x, pis[i - 1].y], [pis[i].x, pis[i].y]) < 1e-6) throw new Error(`PI ${i} coincides with PI ${i - 1}`);
  const segments: AlignmentSegment[] = [];
  let cursor: V2 = [pis[0].x, pis[0].y];
  let station = spec.startStation ?? 0;
  const push = (kind: AlignmentSegmentKind, start: V2, direction: number, length: number, radius: number, turn: 1 | -1, pi: number): AlignmentPoint => {
    const seg: AlignmentSegment = { kind, station, length, start, direction, radius, turn, pi };
    segments.push(seg);
    station += length;
    const end = evalSegment(seg, length);
    cursor = [end.x, end.y];
    return end;
  };
  for (let i = 1; i < pis.length - 1; i++) {
    const prev: V2 = [pis[i - 1].x, pis[i - 1].y], at: V2 = [pis[i].x, pis[i].y], next: V2 = [pis[i + 1].x, pis[i + 1].y];
    const dIn = Math.atan2(at[1] - prev[1], at[0] - prev[0]);
    const dOut = Math.atan2(next[1] - at[1], next[0] - at[0]);
    const delta = wrap(dOut - dIn);
    const R = pis[i].radius ?? 0;
    if (Math.abs(delta) < 1e-9) continue;
    if (!(R > 0)) throw new Error(`PI ${i} turns ${(Math.abs(delta) * 180 / Math.PI).toFixed(1)}° but has no radius`);
    const turn: 1 | -1 = delta > 0 ? 1 : -1;
    const L1 = Math.max(0, pis[i].spiralIn ?? 0), L2 = Math.max(0, pis[i].spiralOut ?? 0);
    const s1 = spiralShift(R, L1), s2 = spiralShift(R, L2);
    const arcAngle = Math.abs(delta) - s1.theta - s2.theta;
    if (arcAngle < -1e-9) throw new Error(`PI ${i}: the spirals turn more than the ${(Math.abs(delta) * 180 / Math.PI).toFixed(1)}° deflection`);
    // The arc centre lies R + p off each tangent, on the inside of the turn.
    const u1: V2 = [Math.cos(dIn), Math.sin(dIn)], u2: V2 = [Math.cos(dOut), Math.sin(dOut)];
    const n1: V2 = [-u1[1] * turn, u1[0] * turn], n2: V2 = [-u2[1] * turn, u2[0] * turn];
    const det = n1[0] * n2[1] - n1[1] * n2[0];
    const c1 = R + s1.p, c2 = R + s2.p;
    const centre: V2 = [at[0] + (c1 * n2[1] - c2 * n1[1]) / det, at[1] + (c2 * n1[0] - c1 * n2[0]) / det];
    const ts = add(add(centre, scale(u1, -s1.k)), scale(n1, -c1));
    const st = add(add(centre, scale(u2, s2.k)), scale(n2, -c2));
    const tangentIn = (at[0] - ts[0]) * u1[0] + (at[1] - ts[1]) * u1[1];
    const run = (ts[0] - cursor[0]) * u1[0] + (ts[1] - cursor[1]) * u1[1];
    if (run < -1e-6) throw new Error(`PI ${i}: its curve (tangent ${tangentIn.toFixed(2)} m) overlaps the previous one; reduce the radius or the spirals`);
    if (run > 1e-9) push('line', cursor, dIn, run, Infinity, 1, i);
    if (L1 > 0) push('spiralIn', ts, dIn, L1, R, turn, i);
    const arcStart = cursor, arcDir = dIn + turn * s1.theta;
    if (arcAngle > 1e-9) push('arc', arcStart, arcDir, R * arcAngle, R, turn, i);
    if (L2 > 0) push('spiralOut', cursor, arcDir + turn * arcAngle, L2, R, turn, i);
    // Snap the numerical end onto the exact ST so the next tangent starts clean.
    cursor = st;
    const tangentOut = (next[0] - st[0]) * u2[0] + (next[1] - st[1]) * u2[1];
    if (tangentOut < -1e-6) throw new Error(`PI ${i}: its curve runs past PI ${i + 1}; reduce the radius or the spirals`);
  }
  const last: V2 = [pis[pis.length - 1].x, pis[pis.length - 1].y];
  const tail = dist(cursor, last);
  if (tail > 1e-9) push('line', cursor, Math.atan2(last[1] - cursor[1], last[0] - cursor[0]), tail, Infinity, 1, pis.length - 1);
  const startStation = spec.startStation ?? 0;
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

/** The largest radius (no spirals) whose tangents fit between a PI's neighbours, with a little room to spare. */
export function fitRadius(prev: V2, at: V2, next: V2, wanted: number): number {
  const dIn = Math.atan2(at[1] - prev[1], at[0] - prev[0]);
  const dOut = Math.atan2(next[1] - at[1], next[0] - at[0]);
  const delta = Math.abs(wrap(dOut - dIn));
  if (delta < 1e-9) return 0;
  const room = Math.min(dist(prev, at), dist(at, next)) / 2 * 0.95;
  return Math.min(wanted, room / Math.tan(delta / 2));
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
