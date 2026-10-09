/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Triangulation of a simple polygon with holes, for the end caps of swept
 * profiles: each hole is bridged into the outline (from its rightmost
 * vertex to a visible outline vertex, holes taken right to left), which
 * leaves one weakly simple loop that ear clipping cuts into triangles.
 * Indices refer to the outline's points followed by each hole's, in order.
 */

type V2 = [number, number];

const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function area(pts: readonly V2[], loop: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = pts[loop[i]], q = pts[loop[(i + 1) % loop.length]];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

function segmentsCross(a: V2, b: V2, c: V2, d: V2): boolean {
  const o1 = Math.sign(cross(a, b, c)), o2 = Math.sign(cross(a, b, d)), o3 = Math.sign(cross(c, d, a)), o4 = Math.sign(cross(c, d, b));
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Splice each hole into the outline through a bridge. Returns one index loop, counter-clockwise. */
function bridge(pts: readonly V2[], outer: number[], holes: number[][]): number[] {
  let ring = area(pts, outer) < 0 ? [...outer].reverse() : [...outer];
  const ordered = holes
    .map((h) => (area(pts, h) > 0 ? [...h].reverse() : [...h]))
    .sort((h1, h2) => Math.max(...h2.map((i) => pts[i][0])) - Math.max(...h1.map((i) => pts[i][0])));
  for (const hole of ordered) {
    const start = hole.reduce((best, i) => (pts[i][0] > pts[best][0] ? i : best), hole[0]);
    const m = pts[start];
    // The nearest ring vertex whose bridge to m crosses no edge of the ring or of the holes still to come.
    const others = ordered.filter((h) => h !== hole);
    const blocked = (v: number) => {
      const p = pts[v];
      const edges = [ring, hole, ...others];
      for (const loop of edges) {
        for (let k = 0; k < loop.length; k++) {
          const a = loop[k], b = loop[(k + 1) % loop.length];
          if (a === v || b === v || a === start || b === start) continue;
          if (segmentsCross(m, p, pts[a], pts[b])) return true;
        }
      }
      return false;
    };
    const candidates = ring.map((v, at) => ({ v, at, d: (pts[v][0] - m[0]) ** 2 + (pts[v][1] - m[1]) ** 2 })).sort((x, y) => x.d - y.d);
    const pick = candidates.find((c) => !blocked(c.v)) ?? candidates[0];
    const h0 = hole.indexOf(start);
    const holeLoop = [...hole.slice(h0), ...hole.slice(0, h0), start];
    ring = [...ring.slice(0, pick.at + 1), ...holeLoop, ...ring.slice(pick.at)];
  }
  return ring;
}

/** Triangles (indices into outline then holes, concatenated) of a polygon with holes; counter-clockwise. */
export function triangulateWithHoles(outer: readonly V2[], holes: readonly (readonly V2[])[] = []): [number, number, number][] {
  const pts: V2[] = [...outer, ...holes.flat()].map((p) => [p[0], p[1]]);
  const outerIdx = outer.map((_, i) => i);
  let base = outer.length;
  const holeIdx = holes.map((h) => { const idx = h.map((_, i) => base + i); base += h.length; return idx; });
  const ring = bridge(pts, outerIdx, holeIdx);
  const out: [number, number, number][] = [];
  const idx = [...ring];
  // A point on an ear's edge blocks it too: cutting there would leave a T-junction, and the cap would not seal against the sides.
  const inside = (p: V2, a: V2, b: V2, c: V2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 100_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-12) continue;
      // Duplicated bridge vertices (same index or same position) never block an ear.
      if (idx.some((k) => k !== ia && k !== ib && k !== ic && !same(pts[k], a) && !same(pts[k], b) && !same(pts[k], c) && inside(pts[k], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate leftovers (collinear bridge seams): drop a vertex that makes no area.
      const flat = idx.findIndex((_, i) => Math.abs(cross(pts[idx[(i + idx.length - 1) % idx.length]], pts[idx[i]], pts[idx[(i + 1) % idx.length]])) <= 1e-12);
      if (flat < 0) break;
      idx.splice(flat, 1);
    }
  }
  if (idx.length === 3 && cross(pts[idx[0]], pts[idx[1]], pts[idx[2]]) > 1e-12) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

const same = (p: V2, q: V2) => Math.abs(p[0] - q[0]) < 1e-12 && Math.abs(p[1] - q[1]) < 1e-12;
