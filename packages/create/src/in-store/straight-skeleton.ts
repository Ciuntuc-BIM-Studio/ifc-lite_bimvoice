/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The straight skeleton of a simple polygon, as the faces of an equal-pitch
 * hip roof over it: every outline edge moves inward at unit speed, and the
 * roof over a point is as high as the time its wavefront needs to get there.
 * Each outline edge ends up owning one planar face — eaves along the edge,
 * hips and valleys where faces meet, ridges on top.
 *
 * Wavefront simulation (Felkel & Obdržálek): active polygons of moving
 * vertices; the next event is the earliest of an EDGE event (an edge
 * shrinks to nothing, its two vertices meet) and a SPLIT event (a reflex
 * vertex runs into a non-adjacent edge, cutting its polygon in two). Every
 * vertex path is a skeleton arc; it separates the faces of its two edges.
 * Outline sizes are small (a building's roof), so each step simply looks at
 * all candidate events: O(n³), and no event queue to keep consistent.
 */

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const EPS = 1e-9;

interface Edge {
  index: number;
  /** How fast the edge's wavefront moves inward (0: a gable, it stays put). */
  speed: number;
  a: Vec2;
  /** Unit direction. */
  d: Vec2;
  /** Unit inward normal (left of d: the outline is counter-clockwise). */
  n: Vec2;
}

interface Node {
  p: Vec2;
  t: number;
}

interface Vertex {
  /** Where (and when) the vertex started moving. */
  origin: Node;
  /** Velocity: away from each edge line at that edge's speed. */
  w: Vec2;
  inEdge: Edge;
  outEdge: Edge;
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

function velocity(inEdge: Edge, outEdge: Edge): Vec2 {
  // dot(w, n1) = s1 and dot(w, n2) = s2.
  const [n1, n2] = [inEdge.n, outEdge.n];
  const [s1, s2] = [inEdge.speed, outEdge.speed];
  const det = n1[0] * n2[1] - n1[1] * n2[0];
  if (Math.abs(det) < 1e-12) {
    const s = (s1 + s2) / 2;
    return [n1[0] * s, n1[1] * s];
  }
  return [(n2[1] * s1 - n1[1] * s2) / det, (n1[0] * s2 - n2[0] * s1) / det];
}

const at = (v: Vertex, t: number): Vec2 => [v.origin.p[0] + (t - v.origin.t) * v.w[0], v.origin.p[1] + (t - v.origin.t) * v.w[1]];

function vertex(origin: Node, inEdge: Edge, outEdge: Edge): Vertex {
  return { origin, w: velocity(inEdge, outEdge), inEdge, outEdge };
}

const reflex = (v: Vertex) => cross(v.inEdge.d, v.outEdge.d) < -EPS;

type Event =
  | { kind: 'edge'; t: number; lav: number; i: number; p: Vec2 }
  | { kind: 'split'; t: number; lav: number; i: number; j: number; p: Vec2 };

/** Collapse time of the edge between vertices `a` and `b` (a before b), or null. */
function edgeEvent(a: Vertex, b: Vertex, now: number): { t: number; p: Vec2 } | null {
  const d = a.outEdge.d;
  const den = dot(sub(a.w, b.w), d);
  if (den <= EPS) return null;
  const num = dot(sub(sub(b.origin.p, [b.origin.t * b.w[0], b.origin.t * b.w[1]]), sub(a.origin.p, [a.origin.t * a.w[0], a.origin.t * a.w[1]])), d);
  const t = num / den;
  return t >= now - EPS ? { t, p: at(a, t) } : null;
}

/** When reflex vertex `v` meets the moving edge from `a` to `b`, or null. */
function splitEvent(v: Vertex, a: Vertex, b: Vertex, now: number): { t: number; p: Vec2 } | null {
  const e = a.outEdge;
  const k = dot(v.w, e.n);
  if (e.speed - k <= EPS) return null;
  // Signed distance of v's path to e's line equals how far that line has moved: d0 + (t - tv)·k = speed·t.
  const d0 = dot(sub(v.origin.p, e.a), e.n);
  const t = (d0 - v.origin.t * k) / (e.speed - k);
  if (t < now - EPS || t <= v.origin.t - EPS) return null;
  const p = at(v, t);
  const pa = at(a, t), pb = at(b, t);
  const s = dot(sub(p, pa), e.d), len = dot(sub(pb, pa), e.d);
  return s >= -1e-7 && s <= len + 1e-7 ? { t, p } : null;
}

/** Drop repeated points, and collinear ones between edges of the same speed; counter-clockwise. Speeds follow their edges. */
function clean(outline: readonly Vec2[], speeds: readonly number[]): { pts: Vec2[]; speeds: number[]; edgeOf: number[] } {
  let pts = outline.map((p) => [p[0], p[1]] as Vec2);
  let sp = [...speeds];
  let edgeOf = speeds.map((_, i) => i);
  const area = pts.reduce((s, p, i) => s + cross(p, pts[(i + 1) % pts.length]), 0);
  if (area < 0) {
    // Edge i (p_i → p_i+1) becomes the edge p_i+1 → p_i of the reversed loop.
    const n = pts.length;
    pts = pts.reverse();
    edgeOf = pts.map((_, j) => (2 * n - 2 - j) % n);
    sp = edgeOf.map((i) => speeds[i]);
  }
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const k = (i + pts.length - 1) % pts.length;
      const prev = pts[k], p = pts[i], next = pts[(i + 1) % pts.length];
      const u = sub(p, prev), w = sub(next, p);
      const repeated = Math.hypot(u[0], u[1]) < 1e-9;
      const straight = Math.abs(cross(u, w)) < 1e-9 * Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]) && dot(u, w) > 0 && Math.abs(sp[k] - sp[i]) < 1e-12;
      if (repeated || straight) {
        pts = pts.filter((_, j) => j !== i);
        // The merged edge keeps the earlier edge's speed.
        sp = sp.filter((_, j) => j !== i);
        edgeOf = edgeOf.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return { pts, speeds: sp, edgeOf };
}

/**
 * The hip-roof faces over `outline` (any simple polygon), heights
 * `tan(slope)` × distance travelled; each face planar and counter-clockwise
 * seen from above, eaves at z = 0.
 */
export function hipRoofFaces(outline: readonly Vec2[], slope: number): Vec3[][] {
  const k = Math.tan(slope);
  return weightedSkeletonFaces(outline, outline.map(() => 1)).map((f) => f.map(([x, y, t]) => [x, y, t * k] as Vec3));
}

/**
 * The faces of the weighted straight skeleton of `outline`: edge i moves
 * inward at `speeds[i]` (≥ 0), and a face point's z is the time its edge's
 * wavefront needs to reach it. With speed = 1 / tan(pitch), z is the roof
 * height over a pitch-per-edge roof; speed 0 keeps an edge in place, its face
 * the vertical gable end. Faces come back in the input edge order (an edge
 * merged away as collinear yields an empty face).
 */
export function weightedSkeletonFaces(outline: readonly Vec2[], speeds: readonly number[]): Vec3[][] {
  if (speeds.length !== outline.length || speeds.some((s) => !(s >= 0) || !Number.isFinite(s))) {
    throw new Error('roof: every outline edge needs a finite speed ≥ 0');
  }
  const cleaned = clean(outline, speeds);
  const pts = cleaned.pts;
  if (pts.length < 3) throw new Error('roof: the outline needs at least 3 corners');
  const edges: Edge[] = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    return { index: i, speed: cleaned.speeds[i], a, d, n: [-d[1], d[0]] };
  });
  // Arcs per face: each a segment between two skeleton nodes.
  const arcs: [Node, Node][][] = edges.map(() => []);
  const trace = (v: Vertex, to: Node) => {
    arcs[v.inEdge.index].push([v.origin, to]);
    arcs[v.outEdge.index].push([v.origin, to]);
  };
  let lavs: Vertex[][] = [pts.map((p, i) => vertex({ p, t: 0 }, edges[(i + pts.length - 1) % pts.length], edges[i]))];
  let now = 0;

  for (let guard = 0; lavs.length > 0 && guard < 10000; guard++) {
    // Two-vertex polygons close as a ridge; empty ones go.
    lavs = lavs.filter((lav) => {
      if (lav.length >= 3) return true;
      if (lav.length === 2) {
        const [a, b] = lav;
        arcs[a.inEdge.index].push([a.origin, b.origin]);
        arcs[a.outEdge.index].push([a.origin, b.origin]);
      }
      return false;
    });
    let best = null as Event | null;
    lavs.forEach((lav, li) => {
      for (let i = 0; i < lav.length; i++) {
        const a = lav[i], b = lav[(i + 1) % lav.length];
        const ev = edgeEvent(a, b, now);
        if (ev && (!best || ev.t < best.t - EPS)) best = { kind: 'edge', t: ev.t, lav: li, i, p: ev.p };
        if (!reflex(a)) continue;
        for (let j = 0; j < lav.length; j++) {
          const ea = lav[j], eb = lav[(j + 1) % lav.length];
          if (ea === a || eb === a) continue;
          const sp = splitEvent(a, ea, eb, now);
          if (sp && (!best || sp.t < best.t - EPS)) best = { kind: 'split', t: sp.t, lav: li, i, j, p: sp.p };
        }
      }
    });
    const ev = best as Event | null;
    if (!ev) break;
    now = ev.t;
    const lav = lavs[ev.lav];
    const node: Node = { p: ev.p, t: ev.t };
    if (ev.kind === 'edge') {
      const a = lav[ev.i], b = lav[(ev.i + 1) % lav.length];
      trace(a, node);
      trace(b, node);
      if (lav.length === 3) {
        // The last triangle: all three meet here.
        trace(lav[(ev.i + 2) % 3], node);
        lavs.splice(ev.lav, 1);
        continue;
      }
      const merged = vertex(node, a.inEdge, b.outEdge);
      const next = lav.filter((x) => x !== a && x !== b);
      const k = (ev.i + 1) % lav.length === 0 ? 0 : ev.i;
      next.splice(Math.min(k, next.length), 0, merged);
      lavs[ev.lav] = next;
    } else {
      const v = lav[ev.i];
      const ea = lav[ev.j], eb = lav[(ev.j + 1) % lav.length];
      trace(v, node);
      const n = lav.length;
      const walk = (from: number, to: Vertex) => {
        const out: Vertex[] = [];
        for (let k = from; lav[k % n] !== to; k++) out.push(lav[k % n]);
        out.push(to);
        return out;
      };
      // v's side: v1 then b … the vertex before v; the other: v2 then after v … a.
      const v1 = vertex(node, v.inEdge, ea.outEdge);
      const v2 = vertex(node, ea.outEdge, v.outEdge);
      const iv = ev.i, ib = lav.indexOf(eb);
      const first = [v1, ...walk(ib, lav[(iv + n - 1) % n])].filter((x) => x !== v);
      const second = [v2, ...walk((iv + 1) % n, ea)].filter((x) => x !== v);
      lavs.splice(ev.lav, 1, first, second);
    }
  }

  const lift = (p: Node): Vec3 => [p.p[0], p.p[1], p.t];
  const out: Vec3[][] = outline.map(() => []);
  edges.forEach((e, i) => { out[cleaned.edgeOf[i]] = faceOf(e, pts[(i + 1) % pts.length], arcs[i], lift); });
  return out;
}

/** Chain a face's arcs from its edge's end back to its start. */
function faceOf(e: Edge, end: Vec2, arcs: [Node, Node][], lift: (p: Node) => Vec3): Vec3[] {
  const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7;
  const loop: Node[] = [{ p: e.a, t: 0 }, { p: end, t: 0 }];
  const left = arcs.filter(([a, b]) => !same(a.p, b.p));
  let cur = end;
  const limit = left.length + 1;
  for (let guard = 0; guard < limit && !same(cur, e.a); guard++) {
    const k = left.findIndex(([a, b]) => same(a.p, cur) || same(b.p, cur));
    if (k < 0) break;
    const [a, b] = left.splice(k, 1)[0];
    const next = same(a.p, cur) ? b : a;
    if (!same(next.p, e.a)) loop.push(next);
    cur = next.p;
  }
  return loop.map(lift);
}
