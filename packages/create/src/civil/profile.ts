/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road's vertical profile (the "red line") in station / elevation space:
 * PVIs (points of vertical intersection) joined by constant grades, each
 * inner PVI rounded by a vertical curve of one of the three kinds roads use:
 *
 *  - parabolic (symmetric): the standard curve, whose grade changes at a
 *    constant rate; it spans L/2 either side of its PVI. L is given, or
 *    follows from K (metres per 1 % of grade change: L = K · |ΔG %|).
 *  - asymmetric parabolic: two parabolas meeting at the PVI, L1 before it
 *    and L2 after (constrained transitions, clearances).
 *  - circular: an arc of radius R tangent to both grades (railways,
 *    low-speed paths).
 */

export type VerticalCurveKind = 'parabolic' | 'asymmetric' | 'circular';

export interface ProfilePVI {
  station: number;
  elevation: number;
  /** The curve rounding this PVI (parabolic when absent). */
  curve?: VerticalCurveKind;
  /** Parabolic curve length, metres (0 / absent: a grade break). */
  length?: number;
  /** Parabolic by K instead of L, metres per 1 % of grade change; wins over `length` when set. */
  k?: number;
  /** Asymmetric: the lengths before and after the PVI, metres. */
  lengthIn?: number;
  lengthOut?: number;
  /** Circular: the radius, metres. */
  radius?: number;
}

export interface VerticalProfileSpec {
  pvis: ProfilePVI[];
}

/** One vertical curve as built: where it runs and what defines it. */
export interface VerticalCurveInfo {
  /** Index of its PVI in station order. */
  pvi: number;
  station: number;
  kind: VerticalCurveKind;
  /** Begin and end of the curve (BVC, EVC). */
  bvc: number;
  evc: number;
  gradeIn: number;
  gradeOut: number;
  /** K-value, m per % of grade change. */
  k: number | null;
  radius?: number;
  lengthIn?: number;
  lengthOut?: number;
}

export interface VerticalProfile {
  startStation: number;
  endStation: number;
  elevationAt(station: number): number;
  /** Grade as a ratio (0.03 = 3 % rising). */
  gradeAt(station: number): number;
  /** BVC / PVI / EVC stations, start and end included. */
  criticalStations(): number[];
  /** Where one geometric segment ends and the next begins: each curve whole (an asymmetric one in its two parabolas), each grade between. */
  segmentStations(): number[];
  /** Inside a circular curve: its radius, positive for a sag, negative for a crest; else null. */
  circularRadiusAt(station: number): number | null;
  /** The vertical curves, in station order. */
  curves(): VerticalCurveInfo[];
}

/** One piece of a vertical curve: a parabola, or a circular arc. */
type Piece =
  | { kind: 'parabola'; s0: number; s1: number; z0: number; g0: number; g1: number }
  | { kind: 'arc'; s0: number; s1: number; cx: number; cz: number; r: number; sag: boolean };

/** A curve's reach either side of its PVI, and its pieces. */
interface Rounding { before: number; after: number; pieces: Piece[] }

/** The length of a parabolic curve: L, or K · |ΔG %|. */
export function parabolaLength(pvi: ProfilePVI, gradeIn: number, gradeOut: number): number {
  if (pvi.k !== undefined && pvi.k > 0) return pvi.k * Math.abs(gradeOut - gradeIn) * 100;
  return pvi.length ?? 0;
}

/** The K-value (m per %) of a parabola of length L between two grades (ratios), or null for no grade change. */
export function kValue(length: number, gradeIn: number, gradeOut: number): number | null {
  const a = Math.abs(gradeOut - gradeIn) * 100;
  return a < 1e-9 ? null : length / a;
}

function rounding(pvi: ProfilePVI, g0: number, g1: number): Rounding {
  const none = { before: 0, after: 0, pieces: [] };
  if (Math.abs(g1 - g0) < 1e-12) return none;
  const { station: d, elevation: h } = pvi;
  switch (pvi.curve ?? 'parabolic') {
    case 'asymmetric': {
      const a = pvi.lengthIn ?? 0, b = pvi.lengthOut ?? 0;
      if (a <= 0 || b <= 0) return none;
      // Two parabolas sharing height and grade at the PVI.
      const mid = g0 + ((g1 - g0) * b) / (a + b);
      const z0 = h - g0 * a;
      return {
        before: a, after: b,
        pieces: [
          { kind: 'parabola', s0: d - a, s1: d, z0, g0, g1: mid },
          { kind: 'parabola', s0: d, s1: d + b, z0: z0 + ((g0 + mid) / 2) * a, g0: mid, g1 },
        ],
      };
    }
    case 'circular': {
      const R = pvi.radius ?? 0;
      if (R <= 0) return none;
      const t1 = Math.atan(g0), t2 = Math.atan(g1);
      const T = R * Math.tan(Math.abs(t2 - t1) / 2);
      const sag = g1 > g0;
      const bvc = { s: d - T * Math.cos(t1), z: h - T * Math.sin(t1) };
      // The centre lies R from the BVC, square to the incoming grade: above for a sag, below for a crest.
      const n = sag ? [-Math.sin(t1), Math.cos(t1)] : [Math.sin(t1), -Math.cos(t1)];
      return {
        before: T * Math.cos(t1), after: T * Math.cos(t2),
        pieces: [{ kind: 'arc', s0: bvc.s, s1: d + T * Math.cos(t2), cx: bvc.s + R * n[0], cz: bvc.z + R * n[1], r: R, sag }],
      };
    }
    default: {
      const L = parabolaLength(pvi, g0, g1);
      if (L <= 0) return none;
      return { before: L / 2, after: L / 2, pieces: [{ kind: 'parabola', s0: d - L / 2, s1: d + L / 2, z0: h - (g0 * L) / 2, g0, g1 }] };
    }
  }
}

function pieceAt(q: Piece, s: number): { z: number; g: number } {
  if (q.kind === 'parabola') {
    const L = q.s1 - q.s0, x = s - q.s0;
    return { z: q.z0 + q.g0 * x + ((q.g1 - q.g0) * x * x) / (2 * L), g: q.g0 + ((q.g1 - q.g0) * x) / L };
  }
  const dx = s - q.cx, root = Math.sqrt(Math.max(q.r * q.r - dx * dx, 1e-12));
  return q.sag ? { z: q.cz - root, g: dx / root } : { z: q.cz + root, g: -dx / root };
}

const sorted = (spec: VerticalProfileSpec) => [...spec.pvis].sort((a, b) => a.station - b.station);
const gradesOf = (p: readonly ProfilePVI[]) => p.slice(1).map((pvi, i) => (pvi.elevation - p[i].elevation) / (pvi.station - p[i].station));

/** Each PVI's rounding (none at the ends). */
function roundings(p: readonly ProfilePVI[]): Rounding[] {
  const grades = gradesOf(p);
  return p.map((pvi, i) => (i === 0 || i === p.length - 1 ? { before: 0, after: 0, pieces: [] } : rounding(pvi, grades[i - 1], grades[i])));
}

/** Why the profile cannot be built, or null. */
export function profileProblem(spec: VerticalProfileSpec): string | null {
  const p = sorted(spec);
  if (p.length < 2) return 'A profile needs at least two PVIs';
  for (let i = 1; i < p.length; i++) {
    if (p[i].station - p[i - 1].station < 1e-6) return `PVIs ${i - 1} and ${i} share a station`;
  }
  const r = roundings(p);
  for (let i = 1; i < p.length; i++) {
    if (r[i - 1].after + r[i].before > p[i].station - p[i - 1].station + 1e-9) return `The vertical curves of PVIs ${i - 1} and ${i} overlap`;
  }
  return null;
}

export function buildProfile(spec: VerticalProfileSpec): VerticalProfile {
  const problem = profileProblem(spec);
  if (problem) throw new Error(problem);
  const p = sorted(spec);
  const grades = gradesOf(p);
  const pieces = roundings(p).flatMap((r) => r.pieces);
  const pieceOf = (s: number) => pieces.find((q) => s >= q.s0 && s <= q.s1) ?? null;
  const clamp = (s: number) => Math.min(Math.max(s, p[0].station), p[p.length - 1].station);
  const tangent = (s: number): number => {
    for (let i = 1; i < p.length; i++) if (s < p[i].station) return i - 1;
    return grades.length - 1;
  };
  const gradeAt = (s: number): number => {
    const q = pieceOf(s);
    return q ? pieceAt(q, s).g : grades[tangent(s)];
  };
  const elevationAt = (station: number): number => {
    const s = clamp(station);
    const q = pieceOf(s);
    if (q) return pieceAt(q, s).z;
    const i = tangent(s);
    return p[i].elevation + grades[i] * (s - p[i].station);
  };
  const criticalStations = () => {
    const out = new Set<number>(p.map((pvi) => pvi.station));
    for (const q of pieces) { out.add(q.s0); out.add(q.s1); }
    return [...out].sort((a, b) => a - b);
  };
  const segmentStations = () => {
    const out = new Set<number>(p.map((pvi) => pvi.station).filter((s) => !pieces.some((q) => s > q.s0 + 1e-9 && s < q.s1 - 1e-9)));
    for (const q of pieces) { out.add(q.s0); out.add(q.s1); }
    return [...out].sort((a, b) => a - b);
  };
  const curveInfo = roundings(p).flatMap((r, i): VerticalCurveInfo[] => {
    if (r.pieces.length === 0) return [];
    const pvi = p[i], g0 = grades[i - 1], g1 = grades[i];
    const kind = pvi.curve ?? 'parabolic';
    return [{
      pvi: i, station: pvi.station, kind, bvc: pvi.station - r.before, evc: pvi.station + r.after, gradeIn: g0, gradeOut: g1,
      k: kValue(r.before + r.after, g0, g1),
      ...(kind === 'circular' ? { radius: pvi.radius } : {}),
      ...(kind === 'asymmetric' ? { lengthIn: r.before, lengthOut: r.after } : {}),
    }];
  });
  const circularRadiusAt = (s: number): number | null => {
    const q = pieceOf(s);
    return q?.kind === 'arc' ? (q.sag ? q.r : -q.r) : null;
  };
  return { startStation: p[0].station, endStation: p[p.length - 1].station, elevationAt, gradeAt, criticalStations, segmentStations, circularRadiusAt, curves: () => curveInfo };
}

/**
 * A profile that follows the ground: the terrain sampled every `every`
 * metres, simplified (Douglas–Peucker, `tolerance` metres) to the PVIs that
 * matter, each rounded by a curve as long as its neighbours allow.
 * `groundAt` returns null off the terrain, which leaves a hole no PVI fills.
 */
export function profileFromGround(startStation: number, endStation: number, groundAt: (station: number) => number | null, every = 10, tolerance = 0.3): VerticalProfileSpec {
  const samples: [number, number][] = [];
  for (let s = startStation; s < endStation; s += every) {
    const z = groundAt(s);
    if (z !== null) samples.push([s, z]);
  }
  const zEnd = groundAt(endStation);
  if (zEnd !== null) samples.push([endStation, zEnd]);
  if (samples.length < 2) return { pvis: [{ station: startStation, elevation: 0 }, { station: endStation, elevation: 0 }] };
  const keep = simplify(samples, tolerance);
  const pvis: ProfilePVI[] = keep.map(([station, elevation]) => ({ station, elevation }));
  for (let i = 1; i < pvis.length - 1; i++) {
    const room = Math.min(pvis[i].station - pvis[i - 1].station, pvis[i + 1].station - pvis[i].station);
    pvis[i].length = Math.round(room * 0.8 * 100) / 100;
  }
  return { pvis };
}

function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let worst = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const t = (pts[i][0] - a[0]) / (b[0] - a[0]);
    const d = Math.abs(pts[i][1] - (a[1] + (b[1] - a[1]) * t));
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [a, b];
  return [...simplify(pts.slice(0, at + 1), tol).slice(0, -1), ...simplify(pts.slice(at), tol)];
}

/** The grades of the tangents between PVIs, in % (one fewer than the PVIs). */
export function segmentGrades(pvis: readonly ProfilePVI[]): number[] {
  return pvis.slice(1).map((p, i) => {
    const run = p.station - pvis[i].station;
    return Math.abs(run) < 1e-9 ? 0 : ((p.elevation - pvis[i].elevation) / run) * 100;
  });
}

/** Set the grade (%) of the tangent ending at PVI `i`: it and every PVI after it move by the same height, so the later grades stay. */
export function withSegmentGrade(pvis: readonly ProfilePVI[], i: number, grade: number): ProfilePVI[] {
  if (i < 1 || i >= pvis.length) return pvis.map((p) => ({ ...p }));
  const target = pvis[i - 1].elevation + (grade / 100) * (pvis[i].station - pvis[i - 1].station);
  const dz = Math.round((target - pvis[i].elevation) * 1000) / 1000;
  return pvis.map((p, k) => (k >= i ? { ...p, elevation: Math.round((p.elevation + dz) * 1000) / 1000 } : { ...p }));
}
