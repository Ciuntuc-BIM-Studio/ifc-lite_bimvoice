/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The timber structure under a roof system (`roof-system.ts`): rafters at a
 * spacing on every plane, hip and valley rafters along hips and valleys, a
 * ridge beam under each ridge, purlins across the planes and wall plates on
 * the eave walls. Members are centre lines with a width × depth section; a
 * rafter's top lies the covering's depth below the roof surface.
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
  /** 'rafters': rafters on purlins; 'none': the covering only. (Trusses come later.) */
  system: 'rafters' | 'none';
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
}

export type MemberRole = 'rafter' | 'hip' | 'valley' | 'ridge' | 'purlin' | 'plate';

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
  };
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

export function roofStructure(g: RoofGeometry, spec: RoofStructureSpec): RoofMember[] {
  if (spec.system === 'none') return [];
  const out: RoofMember[] = [];
  const fs = frames(g);
  const r = spec.rafter;
  const rafterAxis = spec.coverDepth + r.depth / 2;

  fs.forEach((f) => {
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
  const minNormalZ = Math.min(...fs.map((f) => f.normal[2]));
  g.lines.forEach((line, i) => {
    if (line.kind === 'ridge' && spec.ridge) {
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
      const z = -(spec.coverDepth + r.depth) / (f?.normal[2] ?? 1) - spec.wallPlate!.depth / 2;
      out.push({ role: 'plate', key: `plate:${i}`, start: [a[0], a[1], z], end: [b[0], b[1], z], width: spec.wallPlate!.width, depth: spec.wallPlate!.depth });
    });
  }
  return out.filter((m) => Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]) > 0.05);
}
