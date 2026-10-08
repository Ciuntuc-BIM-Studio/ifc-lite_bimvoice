/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The enclosed areas a set of segments forms — AutoCAD's BOUNDARY: lines,
 * arcs and polylines need not be one closed shape; wherever they enclose an
 * area (meeting end to end, crossing, or ending on one another) that area is
 * a loop. Segments are split at every intersection, their ends welded
 * within a tolerance, dangling pieces pruned, and the faces of the planar
 * graph walked (always the next edge clockwise): every bounded face is a
 * counter-clockwise loop. Small inputs (a drawing's drafting) — O(n²)
 * intersections, capped.
 */

import type { Pt } from './types';

export type Segment = [Pt, Pt];

const MAX_SEGMENTS = 4000;

function intersect(a: Segment, b: Segment, eps: number): number[] | null {
  const [p, p2] = a, [q, q2] = b;
  const r = { x: p2.x - p.x, y: p2.y - p.y }, s = { x: q2.x - q.x, y: q2.y - q.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-15) return null;
  const qp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qp.x * s.y - qp.y * s.x) / den;
  const u = (qp.x * r.y - qp.y * r.x) / den;
  const lt = eps / Math.hypot(r.x, r.y), lu = eps / Math.hypot(s.x, s.y);
  if (t < -lt || t > 1 + lt || u < -lu || u > 1 + lu) return null;
  return [Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))];
}

/** Bounded faces (counter-clockwise loops) of the segments' arrangement; `tolerance` welds ends. */
export function arrangementLoops(segments: readonly Segment[], tolerance: number): Pt[][] {
  const segs = segments.filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > tolerance).slice(0, MAX_SEGMENTS);
  // Split parameters per segment.
  const cuts: number[][] = segs.map(() => [0, 1]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const hit = intersect(segs[i], segs[j], tolerance);
      if (!hit) continue;
      cuts[i].push(hit[0]);
      cuts[j].push(hit[1]);
    }
  }
  // Weld vertices on a grid of the tolerance.
  const vertices: Pt[] = [];
  const index = new Map<string, number>();
  const key = (p: Pt) => `${Math.round(p.x / tolerance)},${Math.round(p.y / tolerance)}`;
  const vertex = (p: Pt): number => {
    const k = key(p);
    let id = index.get(k);
    if (id === undefined) {
      id = vertices.length;
      vertices.push(p);
      // Neighbour cells too, so points straddling a cell edge weld.
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        const nk = `${Math.round(p.x / tolerance) + dx},${Math.round(p.y / tolerance) + dy}`;
        if (!index.has(nk)) index.set(nk, id);
      }
      index.set(k, id);
    }
    return id;
  };
  const edges = new Set<string>();
  const adjacency = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edges.has(k)) return;
    edges.add(k);
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  segs.forEach(([a, b], i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e9) / 1e9))].sort((x, y) => x - y);
    let prev = vertex(a);
    for (const t of ts.slice(1)) {
      const id = vertex({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      link(prev, id);
      prev = id;
    }
  });
  // Prune dangling ends: they bound nothing.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [v, ns] of adjacency) {
      if (ns.size >= 2) continue;
      for (const n of ns) adjacency.get(n)?.delete(v);
      adjacency.delete(v);
      pruned = true;
    }
  }
  // Walk faces: from each directed edge u→v, continue with the edge at v that turns most clockwise.
  const angle = (from: number, to: number) => Math.atan2(vertices[to].y - vertices[from].y, vertices[to].x - vertices[from].x);
  const used = new Set<string>();
  const loops: Pt[][] = [];
  for (const [u, ns] of adjacency) {
    for (const v of ns) {
      if (used.has(`${u}>${v}`)) continue;
      const loop: number[] = [];
      let a = u, b = v;
      for (let guard = 0; guard <= edges.size * 2 && !used.has(`${a}>${b}`); guard++) {
        used.add(`${a}>${b}`);
        loop.push(a);
        // The next edge: smallest counter-clockwise turn from the reversed incoming direction.
        const back = angle(b, a);
        let best = -1, bestTurn = Infinity;
        for (const c of adjacency.get(b) ?? []) {
          if (c === a && (adjacency.get(b)?.size ?? 0) > 1) continue;
          let turn = back - angle(b, c);
          while (turn <= 1e-12) turn += Math.PI * 2;
          if (turn < bestTurn) { bestTurn = turn; best = c; }
        }
        if (best < 0) break;
        a = b;
        b = best;
      }
      if (loop.length < 3) continue;
      const pts = loop.map((i) => vertices[i]);
      const area = pts.reduce((s, p, i) => s + p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y, 0) / 2;
      // Bounded faces come out counter-clockwise; the outer face of each component clockwise.
      if (area > tolerance * tolerance) loops.push(pts);
    }
  }
  return loops;
}

/** Whether a closed loop crosses itself (non-adjacent edges intersect). */
export function selfIntersects(loop: readonly Pt[], eps = 1e-9): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a: Segment = [loop[i], loop[(i + 1) % n]];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b: Segment = [loop[j], loop[(j + 1) % n]];
      const hit = intersect(a, b, -eps);
      if (hit && hit[0] > eps && hit[0] < 1 - eps && hit[1] > eps && hit[1] < 1 - eps) return true;
    }
  }
  return false;
}
