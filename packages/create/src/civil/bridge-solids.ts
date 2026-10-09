/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A whole bridge in a corridor, as the corridor builds it:
 *
 * - the deck's range: from face to face of the abutments, reaching back
 *   over each seat to its back wall (less a joint);
 * - the closed solids: abutments and their footings, piers (stem, cap,
 *   footing), each support's line of bearings;
 * - the quarter cones of embankment at each abutment's two sides. A cone's
 *   apex sits on the crest at the abutment's end, at its front face. The
 *   cone turns from the side slope (outward) round to the span (forward),
 *   falling at the fill slope to the ground. It is an open fill surface
 *   with its fill volume;
 * - the cross-section cut through all of it at any station;
 * - the elevation, unrolled along the alignment.
 */

import type { HorizontalAlignment } from './alignment.js';
import type { VerticalProfile } from './profile.js';
import {
  deckDepthOf, extrudeOutline, placeAbutments, seatLength, type AbutmentSpec, type CorridorBridge, type ExtrudedSolid, type PlacedAbutment,
} from './bridge.js';
import { bearingLines, bearingOffsets, bearingSolid, frameAt, pierCut, pierSolids, placePiers, rect, verticalCut, type PlacedPier } from './bridge-piers.js';
import type { P2 } from './structure-profile.js';
import type { Terrain, V3 } from './tin.js';

export interface BridgeSolid extends ExtrudedSolid {
  key: string;
  name: string;
  color: string;
  ifc: { ifcClass: string; predefinedType?: string; objectType?: string };
}

export const BRIDGE_COLORS = { abutment: '#a8a29e', footing: '#78716c', pier: '#9ca3af', cap: '#94a3b8', bearing: '#1f2937' } as const;

const WALL = { ifcClass: 'IfcWall', predefinedType: 'USERDEFINED', objectType: 'Abutment' };
const STRIP = { ifcClass: 'IfcFooting', predefinedType: 'STRIP_FOOTING', objectType: 'Abutment footing' };
const PIER = { ifcClass: 'IfcColumn', predefinedType: 'PIERSTEM', objectType: 'Pier' };
const CAP = { ifcClass: 'IfcBeam', predefinedType: 'PIERCAP', objectType: 'Pier cap' };
const PIER_FOOTING = { ifcClass: 'IfcFooting', predefinedType: 'STRIP_FOOTING', objectType: 'Pier footing' };
const BEARING = { ifcClass: 'IfcBearing', predefinedType: 'ELASTOMERIC', objectType: 'Bearing' };

/** The deck's station range: over the seats, from back wall to back wall. */
export function deckRange(bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null): [number, number] {
  const { start, end } = placeAbutments(bridge, alignment, profile, terrain);
  const over = (pl: PlacedAbutment, outward: -1 | 1) => (pl.back === outward ? seatLength(pl) : 0);
  return [start.station - over(start, -1), end.station + over(end, 1)];
}

export interface BridgeContext {
  alignment: HorizontalAlignment;
  profile: VerticalProfile;
  terrain: Terrain | null;
  /** The finished-grade edge's elevation on a side at a station (the cone's crest). */
  crest: (station: number, side: 'left' | 'right') => number;
  /** Fill slope, horizontal per vertical. */
  fillSlope: number;
}

export interface BridgeCone {
  key: string;
  points: V3[];
  triangles: [number, number, number][];
  volume: number;
  /** The cone's line down toward the span, for the elevation: crest → toe. */
  toe: { from: V3; to: V3 };
}

const CONE_STEPS = 12;

function cone(ctx: BridgeContext, a: AbutmentSpec, pl: PlacedAbutment, end: 'start' | 'end', side: 'left' | 'right'): BridgeCone | null {
  const f = frameAt(ctx.alignment, pl.station);
  const sign = side === 'left' ? -1 : 1;
  const reach = side === 'left' ? a.left : a.right;
  const z = ctx.crest(pl.station, side);
  const apex: V3 = [f.o[0] + f.r[0] * sign * reach, f.o[1] + f.r[1] * sign * reach, z];
  const forward = end === 'start' ? 1 : -1;
  const low = pl.seat + Math.min(...pl.body.map((q) => q[1]));
  const slope = Math.max(ctx.fillSlope, 0.1);
  const rim: V3[] = [];
  for (let i = 0; i <= CONE_STEPS; i++) {
    const th = (Math.PI / 2) * (i / CONE_STEPS);
    const d: [number, number] = [f.r[0] * sign * Math.cos(th) + f.t[0] * forward * Math.sin(th), f.r[1] * sign * Math.cos(th) + f.t[1] * forward * Math.sin(th)];
    const hit = ctx.terrain ? ctx.terrain.hit(apex, [d[0] * slope, d[1] * slope, -1], 150) : null;
    const drop = Math.max(z - low, 0.5);
    rim.push(hit ?? [apex[0] + d[0] * slope * drop, apex[1] + d[1] * slope * drop, z - drop]);
  }
  if (rim.every((p) => z - p[2] < 0.05)) return null;
  const points: V3[] = [apex, ...rim];
  const triangles: [number, number, number][] = [];
  let volume = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], q = points[i + 1];
    const cross = (p[0] - apex[0]) * (q[1] - apex[1]) - (p[1] - apex[1]) * (q[0] - apex[0]);
    // Faces up.
    triangles.push(cross >= 0 ? [0, i, i + 1] : [0, i + 1, i]);
    volume += (Math.abs(cross) / 2) * Math.max(z - (p[2] + q[2]) / 2, 0) / 3;
  }
  return { key: `${end}-${side}`, points, triangles, volume, toe: { from: apex, to: rim[rim.length - 1] } };
}

export interface BridgeParts {
  solids: BridgeSolid[];
  cones: BridgeCone[];
  start: PlacedAbutment;
  end: PlacedAbutment;
  piers: PlacedPier[];
}

/** Everything a bridge builds besides its deck. */
export function bridgeParts(bridge: CorridorBridge, ctx: BridgeContext): BridgeParts {
  const { alignment, profile, terrain } = ctx;
  const { start, end } = placeAbutments(bridge, alignment, profile, terrain);
  const piers = placePiers(bridge, alignment, profile, terrain);
  const solids: BridgeSolid[] = [];
  const add = (key: string, name: string, color: string, ifc: BridgeSolid['ifc'], s: ExtrudedSolid | null) => { if (s && s.triangles.length) solids.push({ key: `bridge:${bridge.id}:${key}`, name: `${bridge.name} — ${name}`, color, ifc, ...s }); };
  for (const [which, pl, a] of [['start', start, bridge.start], ['end', end, bridge.end]] as const) {
    const f = frameAt(alignment, pl.station);
    const origin: V3 = [f.o[0], f.o[1], pl.seat];
    const ex: V3 = [f.t[0] * pl.back, f.t[1] * pl.back, 0];
    add(which, `${which} abutment`, BRIDGE_COLORS.abutment, WALL, extrudeOutline(pl.body, origin, ex, [0, 0, 1], f.r, -a.left, a.right));
    add(`${which}-footing`, `${which} footing`, BRIDGE_COLORS.footing, STRIP, extrudeOutline(pl.footing, origin, ex, [0, 0, 1], f.r, -a.left - 0.3, a.right + 0.3));
  }
  piers.forEach((p, i) => {
    const s = pierSolids(p, alignment);
    add(`pier:${p.spec.id}`, `pier ${i + 1}`, BRIDGE_COLORS.pier, PIER, s.stem);
    add(`pier:${p.spec.id}-cap`, `pier ${i + 1} cap`, BRIDGE_COLORS.cap, CAP, s.cap);
    add(`pier:${p.spec.id}-footing`, `pier ${i + 1} footing`, BRIDGE_COLORS.footing, PIER_FOOTING, s.footing);
  });
  const lines = bearingLines(start, end, piers);
  const names = ['start', ...piers.map((p) => `pier:${p.spec.id}`), 'end'];
  lines.forEach((line, i) => add(`bearings:${names[i]}`, `bearings ${i === 0 ? 'start' : i === lines.length - 1 ? 'end' : `pier ${i}`}`, BRIDGE_COLORS.bearing, BEARING, bearingSolid(bridge, line, alignment)));
  const cones: BridgeCone[] = [];
  for (const [which, pl, a] of [['start', start, bridge.start], ['end', end, bridge.end]] as const) {
    if (a.cones === false) continue;
    for (const side of ['left', 'right'] as const) {
      const c = cone(ctx, a, pl, which, side);
      if (c) cones.push({ ...c, key: `bridge:${bridge.id}:cone:${c.key}` });
    }
  }
  return { solids, cones, start, end, piers };
}

export interface BridgeCutPart {
  id: string;
  name: string;
  color: string;
  loops: P2[][];
}

/** A bridge's supports cut by the cross-section at a station: loops in (offset across, elevation). */
export function bridgeCut(bridge: CorridorBridge, parts: BridgeParts, station: number): BridgeCutPart[] {
  const out: BridgeCutPart[] = [];
  const push = (id: string, name: string, color: string, loops: P2[][]) => { if (loops.length) out.push({ id: `bridge:${bridge.id}:${id}`, name: `${bridge.name} — ${name}`, color, loops }); };
  for (const [which, pl, a] of [['start', parts.start, bridge.start], ['end', parts.end, bridge.end]] as const) {
    const x = (station - pl.station) * pl.back;
    push(which, `${which} abutment`, BRIDGE_COLORS.abutment, verticalCut(pl.body, x).map(([y0, y1]) => rect(-a.left, a.right, pl.seat + y0, pl.seat + y1)));
    push(`${which}-footing`, `${which} footing`, BRIDGE_COLORS.footing, verticalCut(pl.footing, x).map(([y0, y1]) => rect(-a.left - 0.3, a.right + 0.3, pl.seat + y0, pl.seat + y1)));
  }
  parts.piers.forEach((p, i) => {
    const c = pierCut(p, station - p.spec.station);
    push(`pier:${p.spec.id}`, `pier ${i + 1}`, BRIDGE_COLORS.pier, c.stem);
    push(`pier:${p.spec.id}-cap`, `pier ${i + 1} cap`, BRIDGE_COLORS.cap, c.cap);
    push(`pier:${p.spec.id}-footing`, `pier ${i + 1} footing`, BRIDGE_COLORS.footing, c.footing);
  });
  const b = bridge.bearings;
  if (b) {
    const offsets = bearingOffsets(bridge);
    bearingLines(parts.start, parts.end, parts.piers).forEach((line, i) => {
      if (Math.abs(station - (line.station + line.along)) >= b.length / 2) return;
      push(`bearings:${i}`, 'bearings', BRIDGE_COLORS.bearing, offsets.map((c) => rect(c - b.width / 2, c + b.width / 2, line.z, line.z + b.height)));
    });
  }
  return out;
}

/** A bridge drawn in elevation along its alignment: points are (station, elevation). */
export interface BridgeElevation {
  deck: P2[];
  abutments: { body: P2[]; footing: P2[]; height: number }[];
  piers: { stem: P2[]; cap: P2[] | null; footing: P2[]; height: number }[];
  bearings: P2[][];
  /** Each cone's line from the crest down toward the span. */
  cones: [P2, P2][];
  grade: P2[];
  ground: P2[];
}

const box2 = (s0: number, s1: number, z0: number, z1: number): P2[] => [[s0, z0], [s1, z0], [s1, z1], [s0, z1]];

/** The bridge seen from the side, unrolled along the alignment, with the road and the ground a little beyond it. */
export function bridgeElevation(bridge: CorridorBridge, ctx: BridgeContext): BridgeElevation {
  const { alignment, profile, terrain } = ctx;
  const deck = deckDepthOf(bridge);
  const parts = bridgeParts(bridge, ctx);
  const [lo, hi] = deckRange(bridge, alignment, profile, terrain);
  const sample = (a: number, b: number) => {
    const n = Math.max(2, Math.ceil((b - a) / 1));
    return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (i / n));
  };
  const top = sample(lo, hi).map((s): P2 => [s, profile.elevationAt(s) + bridge.deck.offset[1] + deck.maxY]);
  const soffit = sample(lo, hi).reverse().map((s): P2 => [s, profile.elevationAt(s) + bridge.deck.offset[1] + deck.minY]);
  const reach = Math.max(...[parts.start, parts.end].flatMap((pl) => [...pl.body, ...pl.footing].map((q) => Math.abs(q[0])))) + 10;
  const around = sample(Math.max(alignment.startStation, parts.start.station - reach), Math.min(alignment.endStation, parts.end.station + reach));
  const ground = terrain ? around.flatMap((s): P2[] => { const p = alignment.pointAt(s); const z = terrain.elevationAt(p.x, p.y); return z === null ? [] : [[s, z]]; }) : [];
  const unroll = (pl: PlacedAbutment, loop: P2[]) => loop.map(([x, y]): P2 => [pl.station + pl.back * x, pl.seat + y]);
  // A point's station: its projection on the tangent at the abutment it belongs to.
  const stationOf = (pl: PlacedAbutment, p: V3): number => {
    const f = frameAt(alignment, pl.station);
    return pl.station + (p[0] - f.o[0]) * f.t[0] + (p[1] - f.o[1]) * f.t[1];
  };
  const b = bridge.bearings;
  return {
    deck: [...top, ...soffit],
    abutments: [parts.start, parts.end].map((pl) => ({ body: unroll(pl, pl.body), footing: unroll(pl, pl.footing), height: -Math.min(...pl.body.map((q) => q[1])) })),
    piers: parts.piers.map((p) => {
      const s = p.spec, h = s.thickness / 2, capBottom = s.type === 'columns' ? p.top - Math.max(s.cap.depth, 0.2) : p.top;
      const fw = Math.max(s.footing.width, s.thickness, s.type === 'columns' ? s.cap.width : 0) / 2;
      return {
        stem: box2(s.station - h, s.station + h, p.bottom, capBottom),
        cap: s.type === 'columns' ? box2(s.station - s.cap.width / 2, s.station + s.cap.width / 2, capBottom, p.top) : null,
        footing: box2(s.station - fw, s.station + fw, p.bottom - Math.max(s.footing.thickness, 0.2), p.bottom),
        height: p.top - p.bottom,
      };
    }),
    bearings: b && b.count > 0 ? bearingLines(parts.start, parts.end, parts.piers).map((l) => box2(l.station + l.along - b.length / 2, l.station + l.along + b.length / 2, l.z, l.z + b.height)) : [],
    cones: parts.cones.map((c) => {
      const pl = c.key.includes(':cone:start') ? parts.start : parts.end;
      return [[stationOf(pl, c.toe.from), c.toe.from[2]], [stationOf(pl, c.toe.to), c.toe.to[2]]] as [P2, P2];
    }),
    grade: around.map((s): P2 => [s, profile.elevationAt(s)]),
    ground,
  };
}
