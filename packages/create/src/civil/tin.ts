/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A terrain as a TIN (triangulated irregular network): points and the
 * triangles over them, built from survey points by Delaunay triangulation
 * (Bowyer–Watson) or taken from an existing mesh. A grid index over the
 * triangles answers "the ground height here" and "where does this slope
 * line meet the ground" — what the corridor's daylighting needs.
 */

export type V3 = [number, number, number];

export interface Tin {
  points: V3[];
  /** Point indices, three per triangle. */
  triangles: [number, number, number][];
}

interface Circ { x: number; y: number; r2: number }

function circumcircle(a: V3, b: V3, c: V3): Circ | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], b2 = b[0] * b[0] + b[1] * b[1], c2 = c[0] * c[0] + c[1] * c[1];
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r2: (a[0] - x) ** 2 + (a[1] - y) ** 2 };
}

/** Delaunay triangulation of the points' plan positions (duplicates in plan are dropped). */
export function delaunay(input: readonly V3[]): Tin {
  const seen = new Set<string>();
  const points: V3[] = [];
  for (const p of input) {
    const k = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    if (!seen.has(k)) { seen.add(k); points.push([p[0], p[1], p[2]]); }
  }
  if (points.length < 3) return { points, triangles: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]); }
  const span = Math.max(maxX - minX, maxY - minY, 1) * 20;
  const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
  const n = points.length;
  const all: V3[] = [...points, [mx - span, my - span, 0], [mx + span, my - span, 0], [mx, my + span, 0]];
  // Insert in x order so each new point's bad triangles cluster near the end of the list.
  const order = points.map((_, i) => i).sort((i, j) => all[i][0] - all[j][0] || all[i][1] - all[j][1]);
  type Tri = { v: [number, number, number]; c: Circ; dead: boolean };
  const tris: Tri[] = [];
  const make = (i: number, j: number, k: number): Tri | null => {
    const c = circumcircle(all[i], all[j], all[k]);
    return c ? { v: [i, j, k], c, dead: false } : null;
  };
  const seed = make(n, n + 1, n + 2);
  if (seed) tris.push(seed);
  for (const pi of order) {
    const p = all[pi];
    const bad: Tri[] = [];
    for (const t of tris) {
      if (t.dead) continue;
      if ((p[0] - t.c.x) ** 2 + (p[1] - t.c.y) ** 2 <= t.c.r2 * (1 + 1e-12)) bad.push(t);
    }
    // The cavity's boundary: edges of bad triangles not shared by another bad triangle.
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      t.dead = true;
      for (let e = 0; e < 3; e++) {
        const a = t.v[e], b = t.v[(e + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [a, b]);
      }
    }
    for (const [a, b] of edges.values()) {
      const t = make(a, b, pi);
      if (t) tris.push(t);
    }
    if (tris.length > 4 * n + 64 && tris.filter((t) => t.dead).length > tris.length / 2) {
      const live = tris.filter((t) => !t.dead);
      tris.length = 0;
      tris.push(...live);
    }
  }
  const triangles: [number, number, number][] = [];
  for (const t of tris) {
    if (t.dead || t.v.some((i) => i >= n)) continue;
    const [i, j, k] = t.v;
    const a = all[i], b = all[j], c = all[k];
    // Counter-clockwise seen from above.
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
    triangles.push(ccw ? [i, j, k] : [i, k, j]);
  }
  return { points, triangles };
}

/** A TIN from a triangle mesh (positions xyz interleaved, three indices per triangle), vertices de-duplicated. */
export function tinFromMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, transform?: (p: V3) => V3): Tin {
  const points: V3[] = [];
  const index = new Map<string, number>();
  const remap: number[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const raw: V3 = [positions[i], positions[i + 1], positions[i + 2]];
    const p = transform ? transform(raw) : raw;
    const k = p.map((v) => v.toFixed(5)).join(',');
    let id = index.get(k);
    if (id === undefined) { id = points.length; index.set(k, id); points.push(p); }
    remap.push(id);
  }
  const triangles: [number, number, number][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const pa = points[a], pb = points[b], pc = points[c];
    const area2 = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
    if (Math.abs(area2) < 1e-10) continue;
    triangles.push(area2 > 0 ? [a, b, c] : [a, c, b]);
  }
  return { points, triangles };
}

/** Point-location over a TIN: ground height at (x, y) and where a line meets the ground. */
export class Terrain {
  private readonly cell: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly buckets: number[][];
  readonly bounds: { minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number };

  constructor(readonly tin: Tin) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of tin.points) {
      minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
    }
    if (tin.points.length === 0) { minX = minY = maxX = maxY = minZ = maxZ = 0; }
    this.bounds = { minX, minY, maxX, maxY, minZ, maxZ };
    const side = Math.max(Math.sqrt(Math.max((maxX - minX) * (maxY - minY), 1e-9) / Math.max(tin.triangles.length, 1)) * 2, 1e-6);
    this.cell = side;
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / side) + 1);
    this.rows = Math.max(1, Math.ceil((maxY - minY) / side) + 1);
    this.buckets = Array.from({ length: this.cols * this.rows }, () => []);
    tin.triangles.forEach((t, i) => {
      const xs = t.map((v) => tin.points[v][0]), ys = t.map((v) => tin.points[v][1]);
      const c0 = this.col(Math.min(...xs)), c1 = this.col(Math.max(...xs)), r0 = this.row(Math.min(...ys)), r1 = this.row(Math.max(...ys));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.buckets[r * this.cols + c].push(i);
    });
  }

  private col(x: number): number { return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))); }
  private row(y: number): number { return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cell))); }

  /** Ground height at (x, y), or null off the TIN. */
  elevationAt(x: number, y: number): number | null {
    const { minX, minY, maxX, maxY } = this.bounds;
    if (x < minX - 1e-9 || x > maxX + 1e-9 || y < minY - 1e-9 || y > maxY + 1e-9) return null;
    const pts = this.tin.points;
    for (const ti of this.buckets[this.row(y) * this.cols + this.col(x)]) {
      const [i, j, k] = this.tin.triangles[ti];
      const a = pts[i], b = pts[j], c = pts[k];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-14) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      const w = 1 - u - v;
      if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return u * a[2] + v * b[2] + w * c[2];
    }
    return null;
  }

  /**
   * Where the line from `origin` along `direction` (not necessarily unit)
   * first meets the ground, within `maxRun` metres of plan travel: the point,
   * or null when it stays off the terrain or never meets it.
   */
  hit(origin: V3, direction: V3, maxRun: number): V3 | null {
    const planLen = Math.hypot(direction[0], direction[1]);
    if (planLen < 1e-12) {
      const z = this.elevationAt(origin[0], origin[1]);
      return z === null ? null : [origin[0], origin[1], z];
    }
    const d: V3 = [direction[0] / planLen, direction[1] / planLen, direction[2] / planLen];
    const step = Math.max(this.cell / 4, 0.05);
    const at = (t: number): V3 => [origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t];
    const gap = (t: number): number | null => {
      const p = at(t);
      const z = this.elevationAt(p[0], p[1]);
      return z === null ? null : p[2] - z;
    };
    let t0 = 0;
    let g0 = gap(0);
    if (g0 === null) return null;
    if (Math.abs(g0) < 1e-6) return at(0);
    for (let t = step; t <= maxRun + 1e-9; t += step) {
      const g = gap(t);
      if (g === null) return null;
      if (g === 0 || (g0 < 0) !== (g < 0)) {
        let lo = t0, hi = t;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const gm = gap(mid);
          if (gm === null) break;
          if ((gm < 0) === (g0 < 0)) lo = mid; else hi = mid;
        }
        return at((lo + hi) / 2);
      }
      t0 = t;
      g0 = g;
    }
    return null;
  }
}

/** Parse survey points from text: `x y z`, `x,y,z` or PENZD (`id northing easting elevation [description]`) per line. */
export function parseSurveyPoints(text: string): V3[] {
  const out: V3[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const parts = line.split(/[\s,;\t]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (parts.length >= 4 && nums.slice(0, 4).every(Number.isFinite)) out.push([nums[2], nums[1], nums[3]]);
    else if (parts.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) out.push([nums[0], nums[1], nums[2]]);
  }
  return out;
}
