/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The timber structure under a roof system (`roof-system.ts`). Rafters on
 * purlins: rafters at a spacing on every plane, hip and valley rafters along
 * hips and valleys, a ridge beam under each ridge, purlins across the planes
 * and wall plates on the eave walls. Trusses: vertical frames at a spacing
 * across the ridge (or up the slope of a mono-pitch) — top chords cut from
 * the roof surface, a bottom chord between the walls, a king post under the
 * apex and, in a fink truss, a strut from each top chord to the bottom
 * chord — with the wall plates and hip / valley rafters. Members are centre
 * lines with a width × depth section; a rafter's or chord's top lies the
 * covering's depth below the roof surface.
 *
 * Coordinates as the roof's: the outline's plane, z up from the wall plate.
 */

import type { RoofGeometry, RoofPlane } from './roof-system.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

export interface MemberSection {
  width: number;
  depth: number;
}

export interface RoofStructureSpec {
  /** 'rafters': rafters on purlins; 'trusses': trusses across the ridge; 'none': the covering only. */
  system: 'rafters' | 'trusses' | 'none';
  rafter: MemberSection & { spacing: number };
  /** Purlins per plane (0 … 3), spread up the slope. */
  purlins: number;
  purlin: MemberSection;
  ridge: MemberSection | null;
  wallPlate: MemberSection | null;
  /** Hip and valley rafters (deeper than the common ones). */
  hipRafter: MemberSection | null;
  /** The build-up above the rafters (battens, covering), measured across the slope. */
  coverDepth: number;
  /** Trusses (used by the 'trusses' system; older specs may lack it). */
  truss?: TrussSpec;
}

export interface TrussSpec {
  spacing: number;
  /** Top and bottom chords. */
  chord: MemberSection;
  /** King post and struts. */
  web: MemberSection;
  /** 'king': a king post only; 'fink': the king post and a strut from each top chord. */
  pattern: 'king' | 'fink';
}

export type MemberRole = 'rafter' | 'hip' | 'valley' | 'ridge' | 'purlin' | 'plate' | 'chord' | 'tie' | 'post' | 'strut';

export interface RoofMember {
  role: MemberRole;
  /** Stable within a generation: role, plane / line and order (regeneration keeps GlobalIds by it). */
  key: string;
  start: Vec3;
  end: Vec3;
  width: number;
  depth: number;
}

export function defaultRoofStructure(): RoofStructureSpec {
  return {
    system: 'rafters',
    rafter: { width: 0.08, depth: 0.16, spacing: 0.8 },
    purlins: 1,
    purlin: { width: 0.14, depth: 0.16 },
    ridge: { width: 0.14, depth: 0.2 },
    wallPlate: { width: 0.14, depth: 0.14 },
    hipRafter: { width: 0.1, depth: 0.2 },
    coverDepth: 0.06,
    truss: defaultTruss(),
  };
}

export function defaultTruss(): TrussSpec {
  return { spacing: 1.2, chord: { width: 0.06, depth: 0.16 }, web: { width: 0.06, depth: 0.12 }, pattern: 'fink' };
}

/** Inside intervals of the line p + u·t across a polygon (plan), as [t0, t1] pairs. */
function crossings(poly: readonly Vec2[], p: Vec2, u: Vec2): [number, number][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e: Vec2 = [b[0] - a[0], b[1] - a[1]];
    const den = u[0] * e[1] - u[1] * e[0];
    if (Math.abs(den) < 1e-12) continue;
    const w: Vec2 = [a[0] - p[0], a[1] - p[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * u[1] - w[1] * u[0]) / den;
    // Half-open on the edge so a vertex counts once.
    if (s >= 0 && s < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] - ts[i] > 1e-6) out.push([ts[i], ts[i + 1]]);
  return out;
}

interface PlaneFrame {
  plane: RoofPlane;
  plan: Vec2[];
  /** Along the eave edge, and up the slope (plan, unit). */
  d: Vec2;
  n: Vec2;
  /** The wall-plate edge start: z = 0 there. */
  a: Vec2;
  tan: number;
  /** Upward unit normal of the roof surface. */
  normal: Vec3;
}

function frames(g: RoofGeometry): PlaneFrame[] {
  const n = g.outline.length;
  return g.planes.map((plane) => {
    const a = g.outline[plane.edge], b = g.outline[(plane.edge + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const nn: Vec2 = [-d[1], d[0]];
    const tan = Math.tan((plane.pitch * Math.PI) / 180);
    const len = Math.hypot(tan, 1);
    return { plane, plan: plane.pts.map((p) => [p[0], p[1]] as Vec2), d, n: nn, a, tan, normal: [-nn[0] * tan / len, -nn[1] * tan / len, 1 / len] };
  });
}

const heightOn = (f: PlaneFrame, p: Vec2) => ((p[0] - f.a[0]) * f.n[0] + (p[1] - f.a[1]) * f.n[1]) * f.tan;

/** A point on the surface lowered across the slope by `drop`. */
function below(f: PlaneFrame, p: Vec2, drop: number): Vec3 {
  return [p[0] - f.normal[0] * drop, p[1] - f.normal[1] * drop, heightOn(f, p) - f.normal[2] * drop];
}

/** The direction trusses are spaced along: the longest ridge, or a mono-pitch's eave. */
function spanDirection(g: RoofGeometry): Vec2 {
  let best: { len: number; u: Vec2 } | null = null;
  for (const l of g.lines) {
    if (l.kind !== 'ridge') continue;
    const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]);
    if (len > 1e-6 && (!best || len > best.len)) best = { len, u: [(l.b[0] - l.a[0]) / len, (l.b[1] - l.a[1]) / len] };
  }
  if (best) return best.u;
  const n = g.outline.length;
  const i = Math.max(0, g.rules.findIndex((r) => r.kind === 'eave'));
  const a = g.outline[i], b = g.outline[(i + 1) % n];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
}

function trusses(g: RoofGeometry, fs: PlaneFrame[], spec: RoofStructureSpec, tr: TrussSpec, tieZ: number, out: RoofMember[]): void {
  const u = spanDirection(g);
  const v: Vec2 = [-u[1], u[0]];
  const o = g.outline[0];
  const along = g.outline.map((p) => (p[0] - o[0]) * u[0] + (p[1] - o[1]) * u[1]);
  const lo = Math.min(...along) + tr.chord.width / 2, hi = Math.max(...along) - tr.chord.width / 2;
  const count = Math.max(1, Math.round((hi - lo) / tr.spacing));
  const chordAxis = spec.coverDepth + tr.chord.depth / 2;
  for (let k = 0; k <= count; k++) {
    const s = hi > lo ? lo + ((hi - lo) * k) / count : (lo + hi) / 2;
    const p: Vec2 = [o[0] + u[0] * s, o[1] + u[1] * s];
    const at = (t: number): Vec2 => [p[0] + v[0] * t, p[1] + v[1] * t];
    // Top chords: the roof surface along the truss line, one per plane crossed.
    const chords: { t0: number; t1: number; f: PlaneFrame }[] = [];
    for (const f of fs) for (const [t0, t1] of crossings(f.plan, p, v)) chords.push({ t0, t1, f });
    chords.sort((a, b) => a.t0 - b.t0);
    chords.forEach((c, m) => {
      out.push({ role: 'chord', key: `truss:${k}:chord:${m}`, start: below(c.f, at(c.t0), chordAxis), end: below(c.f, at(c.t1), chordAxis), width: tr.chord.width, depth: tr.chord.depth });
    });
    if (chords.length === 0) continue;
    // Bottom chord: wall to wall.
    const ties = crossings(g.outline, p, v);
    ties.forEach(([t0, t1], m) => {
      out.push({ role: 'tie', key: `truss:${k}:tie:${m}`, start: [...at(t0), tieZ], end: [...at(t1), tieZ], width: tr.chord.width, depth: tr.chord.depth });
    });
    if (ties.length === 0) continue;
    const tie = ties.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    // The apex: the highest point of the section (a plane's upper end).
    let apex = { t: 0, z: -Infinity };
    for (const c of chords) for (const t of [c.t0, c.t1]) {
      const z = heightOn(c.f, at(t));
      if (z > apex.z + 1e-9) apex = { t, z };
    }
    const tieAt = (t: number): Vec3 => [...at(t), tieZ + tr.chord.depth / 2];
    const postTop = apex.z - chordAxis / Math.max(...chords.map((c) => c.f.normal[2]));
    if (apex.t > tie[0] + 0.05 && apex.t < tie[1] - 0.05 && postTop - tieZ > 0.2) {
      out.push({ role: 'post', key: `truss:${k}:post`, start: tieAt(apex.t), end: [...at(apex.t), postTop], width: tr.web.width, depth: tr.web.depth });
    }
    if (tr.pattern === 'fink') {
      chords.forEach((c, m) => {
        const mid = (c.t0 + c.t1) / 2;
        const foot = (mid + apex.t) / 2;
        if (foot <= tie[0] || foot >= tie[1]) return;
        const top = below(c.f, at(mid), chordAxis + tr.chord.depth / 2);
        out.push({ role: 'strut', key: `truss:${k}:strut:${m}`, start: tieAt(foot), end: top, width: tr.web.width, depth: tr.web.depth });
      });
    }
  }
}

export function roofStructure(g: RoofGeometry, spec: RoofStructureSpec): RoofMember[] {
  if (spec.system === 'none') return [];
  const out: RoofMember[] = [];
  const fs = frames(g);
  const r = spec.rafter;
  const rafterAxis = spec.coverDepth + r.depth / 2;
  const minNormalZ = Math.min(...fs.map((f) => f.normal[2]));
  const tr = spec.truss ?? defaultTruss();
  // What rests on the wall plates: the rafters' feet, or the trusses' bottom chords.
  const feetDepth = spec.system === 'trusses' ? tr.chord.depth : r.depth;
  const tieZ = -(spec.coverDepth + tr.chord.depth) / minNormalZ - tr.chord.depth / 2;
  if (spec.system === 'trusses') trusses(g, fs, spec, tr, tieZ, out);

  fs.forEach((f) => {
    if (spec.system !== 'rafters') return;
    // Rafters: across the plane's extent along its eave, every `spacing`, up the slope.
    const along = f.plan.map((p) => (p[0] - f.a[0]) * f.d[0] + (p[1] - f.a[1]) * f.d[1]);
    const lo = Math.min(...along) + r.width / 2, hi = Math.max(...along) - r.width / 2;
    const count = Math.max(1, Math.round((hi - lo) / r.spacing));
    for (let j = 0; j <= count; j++) {
      const s = hi > lo ? lo + ((hi - lo) * j) / count : (lo + hi) / 2;
      const p: Vec2 = [f.a[0] + f.d[0] * s, f.a[1] + f.d[1] * s];
      crossings(f.plan, p, f.n).forEach(([t0, t1], m) => {
        const A: Vec2 = [p[0] + f.n[0] * t0, p[1] + f.n[1] * t0], B: Vec2 = [p[0] + f.n[0] * t1, p[1] + f.n[1] * t1];
        out.push({ role: 'rafter', key: `rafter:${f.plane.edge}:${j}:${m}`, start: below(f, A, rafterAxis), end: below(f, B, rafterAxis), width: r.width, depth: r.depth });
      });
    }
    // Purlins: horizontal, under the rafters, spread up the slope.
    const top = Math.max(...f.plane.pts.map((q) => q[2]));
    for (let j = 1; j <= spec.purlins; j++) {
      const h = (top * j) / (spec.purlins + 1);
      const dist = h / f.tan;
      const p: Vec2 = [f.a[0] + f.n[0] * dist, f.a[1] + f.n[1] * dist];
      const z = h - (spec.coverDepth + r.depth) / f.normal[2] - spec.purlin.depth / 2;
      crossings(f.plan, p, f.d).forEach(([t0, t1], m) => {
        out.push({
          role: 'purlin', key: `purlin:${f.plane.edge}:${j}:${m}`,
          start: [p[0] + f.d[0] * t0, p[1] + f.d[1] * t0, z], end: [p[0] + f.d[0] * t1, p[1] + f.d[1] * t1, z],
          width: spec.purlin.width, depth: spec.purlin.depth,
        });
      });
    }
  });

  // Ridge beams, hip and valley rafters: along the roof's lines, below the rafters.
  g.lines.forEach((line, i) => {
    if (line.kind === 'ridge' && spec.ridge && spec.system === 'rafters') {
      const dz = (spec.coverDepth + r.depth) / minNormalZ + spec.ridge.depth / 2;
      out.push({ role: 'ridge', key: `ridge:${i}`, start: [line.a[0], line.a[1], line.a[2] - dz], end: [line.b[0], line.b[1], line.b[2] - dz], width: spec.ridge.width, depth: spec.ridge.depth });
    }
    if ((line.kind === 'hip' || line.kind === 'valley') && spec.hipRafter) {
      const dz = (spec.coverDepth + spec.hipRafter.depth / 2) / minNormalZ;
      out.push({ role: line.kind, key: `${line.kind}:${i}`, start: [line.a[0], line.a[1], line.a[2] - dz], end: [line.b[0], line.b[1], line.b[2] - dz], width: spec.hipRafter.width, depth: spec.hipRafter.depth });
    }
  });

  // Wall plates on the eave walls, under the rafters' feet.
  if (spec.wallPlate) {
    const n = g.outline.length;
    g.rules.forEach((rule, i) => {
      if (rule.kind !== 'eave') return;
      const f = fs.find((x) => x.plane.edge === i);
      const a = g.outline[i], b = g.outline[(i + 1) % n];
      const z = spec.system === 'trusses' ? tieZ - tr.chord.depth / 2 - spec.wallPlate!.depth / 2 : -(spec.coverDepth + feetDepth) / (f?.normal[2] ?? 1) - spec.wallPlate!.depth / 2;
      out.push({ role: 'plate', key: `plate:${i}`, start: [a[0], a[1], z], end: [b[0], b[1], z], width: spec.wallPlate!.width, depth: spec.wallPlate!.depth });
    });
  }
  return out.filter((m) => Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]) > 0.05);
}
