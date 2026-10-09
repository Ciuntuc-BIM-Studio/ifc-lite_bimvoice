/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road's vertical profile (the "red line") in station / elevation space:
 * PVIs (points of vertical intersection) joined by constant grades, each
 * inner PVI rounded by a symmetric parabolic curve of length L — the
 * standard vertical curve, whose grade changes at a constant rate. The
 * curve spans L/2 either side of its PVI (BVC … EVC).
 */

export interface ProfilePVI {
  station: number;
  elevation: number;
  /** Parabolic curve length, metres (0 / absent: a grade break). */
  length?: number;
}

export interface VerticalProfileSpec {
  pvis: ProfilePVI[];
}

export interface VerticalProfile {
  startStation: number;
  endStation: number;
  elevationAt(station: number): number;
  /** Grade as a ratio (0.03 = 3 % rising). */
  gradeAt(station: number): number;
  /** BVC / PVI / EVC stations, start and end included. */
  criticalStations(): number[];
}

/** Why the profile cannot be built, or null. */
export function profileProblem(spec: VerticalProfileSpec): string | null {
  const p = [...spec.pvis].sort((a, b) => a.station - b.station);
  if (p.length < 2) return 'A profile needs at least two PVIs';
  for (let i = 1; i < p.length; i++) {
    if (p[i].station - p[i - 1].station < 1e-6) return `PVIs ${i - 1} and ${i} share a station`;
    const l0 = i === 1 ? 0 : (p[i - 1].length ?? 0) / 2, l1 = i === p.length - 1 ? 0 : (p[i].length ?? 0) / 2;
    if (l0 + l1 > p[i].station - p[i - 1].station + 1e-9) return `The vertical curves of PVIs ${i - 1} and ${i} overlap`;
  }
  return null;
}

export function buildProfile(spec: VerticalProfileSpec): VerticalProfile {
  const problem = profileProblem(spec);
  if (problem) throw new Error(problem);
  const p = [...spec.pvis].sort((a, b) => a.station - b.station);
  const grades = p.slice(1).map((pvi, i) => (pvi.elevation - p[i].elevation) / (pvi.station - p[i].station));
  const gradeAt = (s: number): number => {
    for (let i = 1; i < p.length - 1; i++) {
      const L = p[i].length ?? 0;
      if (L > 0 && s >= p[i].station - L / 2 && s <= p[i].station + L / 2) {
        return grades[i - 1] + (grades[i] - grades[i - 1]) * (s - (p[i].station - L / 2)) / L;
      }
    }
    for (let i = 1; i < p.length; i++) if (s < p[i].station) return grades[i - 1];
    return grades[grades.length - 1];
  };
  const elevationAt = (s: number): number => {
    const clamped = Math.min(Math.max(s, p[0].station), p[p.length - 1].station);
    for (let i = 1; i < p.length - 1; i++) {
      const L = p[i].length ?? 0;
      const bvc = p[i].station - L / 2;
      if (L > 0 && clamped >= bvc && clamped <= p[i].station + L / 2) {
        const x = clamped - bvc;
        const zBvc = p[i].elevation - grades[i - 1] * L / 2;
        return zBvc + grades[i - 1] * x + (grades[i] - grades[i - 1]) * x * x / (2 * L);
      }
    }
    for (let i = 1; i < p.length; i++) {
      if (clamped <= p[i].station) return p[i - 1].elevation + grades[i - 1] * (clamped - p[i - 1].station);
    }
    return p[p.length - 1].elevation;
  };
  const criticalStations = () => {
    const out = new Set<number>();
    p.forEach((pvi, i) => {
      out.add(pvi.station);
      const L = i > 0 && i < p.length - 1 ? pvi.length ?? 0 : 0;
      if (L > 0) { out.add(pvi.station - L / 2); out.add(pvi.station + L / 2); }
    });
    return [...out].sort((a, b) => a - b);
  };
  return { startStation: p[0].station, endStation: p[p.length - 1].station, elevationAt, gradeAt, criticalStations };
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
