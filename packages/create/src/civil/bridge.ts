/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridges in a corridor: over a station range the road runs on a deck (a
 * library profile swept on the axis — no earthworks there), carried at each
 * end by an abutment on a continuous (strip) footing. An abutment's section
 * is a library profile too — the two standard ones are presets:
 *
 * - wall abutment: a front wall the depth of the drop, with a back wall
 *   (ballast wall) up to the deck's top behind the bearing seat;
 * - gravity abutment: a mass wall with a vertical front and a battered back,
 *   with the same back wall;
 *
 * or any profile edited point by point. Its frame lies in the alignment's
 * vertical plane — x from the front face back into the embankment, y up
 * from the bearing seat (the deck's soffit) — and it is extruded straight
 * across the road, `left` metres to the left of the alignment and `right`
 * to the right. The start abutment looks forward along the road, the end
 * one back; `mirror` turns one round. With `autoHeight` (the default) it
 * reaches from the seat down to a metre below the ground (the footing's
 * top): a preset's height follows, a drawn profile stretches below the
 * seat; without terrain, or with `autoHeight` off, the profile's own height
 * is used. A preset's back wall always rises to the deck's top.
 */

import type { HorizontalAlignment } from './alignment.js';
import type { VerticalProfile } from './profile.js';
import { profileBounds, profileFromPreset, regenerateProfile, type P2, type PresetId, type StructureProfile } from './structure-profile.js';
import { triangulateWithHoles } from './triangulate.js';
import type { Terrain, V3 } from './tin.js';

export type AbutmentType = 'wall' | 'gravity';

export interface AbutmentSpec {
  /** The library profile it was taken from, and its own copy (which is what is built). */
  profileId: string;
  profile: StructureProfile;
  /** Across the road from the alignment, metres. */
  left: number;
  right: number;
  /** Down to a metre under the ground (default); false: the profile's own height. */
  autoHeight?: boolean;
  footing: { width: number; thickness: number; toe: number };
  /** Turned round about its own vertical axis (front ↔ back). */
  mirror?: boolean;
}

export interface CorridorBridge {
  id: string;
  name: string;
  /** Stations of the two abutments' front faces. */
  from: number;
  to: number;
  /** The deck's profile (a library copy), its offset from the axis at grade and its cross-fall (%, + right side up). */
  deck: { profileId: string; profile: StructureProfile; offset: [number, number]; tilt?: number };
  start: AbutmentSpec;
  end: AbutmentSpec;
}

export const abutmentPreset = (type: AbutmentType): PresetId => (type === 'wall' ? 'wall-abutment' : 'gravity-abutment');

const FOOTINGS: Record<AbutmentType, AbutmentSpec['footing']> = { wall: { width: 4, thickness: 1, toe: 1 }, gravity: { width: 4.5, thickness: 1, toe: 0.5 } };

/** A standard abutment (or one of the given profile), `halfWidth` either side of the axis. */
export function defaultAbutment(type: AbutmentType, halfWidth: number, profile?: StructureProfile): AbutmentSpec {
  const p = profile ?? profileFromPreset(abutmentPreset(type), `preset:${abutmentPreset(type)}`);
  return { profileId: p.id, profile: p, left: halfWidth, right: halfWidth, autoHeight: true, footing: { ...FOOTINGS[p.preset?.id === 'gravity-abutment' ? 'gravity' : type] } };
}

/** An abutment's profile; one saved before abutments were profiles (type, stem, base, back wall, height) becomes its preset. */
export function abutmentProfile(a: AbutmentSpec): StructureProfile {
  if (a.profile && a.profile.outer?.length >= 3) return a.profile;
  const old = a as Partial<AbutmentSpec> & { type?: AbutmentType; stem?: number; base?: number; backwall?: number; height?: number };
  const p = profileFromPreset(abutmentPreset(old.type ?? 'wall'), a.profileId ?? 'abutment');
  const params: Record<string, number> = { ...p.preset!.params };
  for (const k of ['stem', 'base', 'backwall', 'height'] as const) if (typeof old[k] === 'number') params[k] = old[k]!;
  return regenerateProfile({ ...p, preset: { id: p.preset!.id, params } });
}

const autoHeight = (a: AbutmentSpec) => a.autoHeight ?? (a as { height?: number }).height === undefined;

/**
 * An abutment's section (x back from the front face, y up from the seat) at a height (null: the
 * profile's own) under a deck of the given depth, and its footing's under the body's lowest edge.
 */
export function abutmentSections(a: AbutmentSpec, height: number | null, deckDepth: number): { body: P2[]; footing: P2[] } {
  const p = abutmentProfile(a);
  let body = p.outer;
  if (p.preset) {
    const params = { ...p.preset.params, backwallHeight: Math.max(deckDepth, 0.3), ...(height !== null ? { height: Math.max(height, 0.5) } : {}) };
    body = regenerateProfile({ ...p, preset: { id: p.preset.id, params } }).outer;
  } else if (height !== null) {
    const low = Math.min(...body.map((q) => q[1]));
    // A drawn profile stretches below the seat.
    if (low < -1e-6) body = body.map(([x, y]): P2 => [x, y < 0 ? y * Math.max(height, 0.5) / -low : y]);
  }
  const low = Math.min(...body.map((q) => q[1]));
  const bottom = body.filter((q) => q[1] < low + 1e-6).map((q) => q[0]);
  const x0 = Math.min(...bottom), b = Math.max(...bottom) - x0;
  const ft = Math.max(a.footing.thickness, 0.2), fw = Math.max(a.footing.width, b), toe = Math.min(Math.max(a.footing.toe, 0), fw - b);
  const footing: P2[] = [[x0 - toe, low - ft], [x0 - toe + fw, low - ft], [x0 - toe + fw, low], [x0 - toe, low]];
  return { body, footing };
}

export interface ExtrudedSolid {
  points: V3[];
  triangles: [number, number, number][];
}

/** A closed prism: the 2D outline in the plane (origin, ex, ey), extruded along ez from z0 to z1. */
export function extrudeOutline(outline: readonly P2[], origin: V3, ex: V3, ey: V3, ez: V3, z0: number, z1: number): ExtrudedSolid {
  const at = (p: P2, z: number): V3 => [
    origin[0] + ex[0] * p[0] + ey[0] * p[1] + ez[0] * z,
    origin[1] + ex[1] * p[0] + ey[1] * p[1] + ez[1] * z,
    origin[2] + ex[2] * p[0] + ey[2] * p[1] + ez[2] * z,
  ];
  const n = outline.length;
  const points = [...outline.map((p) => at(p, z0)), ...outline.map((p) => at(p, z1))];
  const triangles: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triangles.push([i, n + i, n + j], [i, n + j, j]);
  }
  for (const [a, b, c] of triangulateWithHoles(outline)) {
    triangles.push([a, b, c]);
    triangles.push([n + a, n + c, n + b]);
  }
  let volume = 0;
  for (const [i, j, k] of triangles) {
    const a = points[i], b = points[j], c = points[k];
    volume += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  if (volume < 0) for (const t of triangles) [t[1], t[2]] = [t[2], t[1]];
  return { points, triangles };
}

export interface BridgeAbutmentSolids {
  body: ExtrudedSolid;
  footing: ExtrudedSolid;
  /** Seat to footing top, metres. */
  height: number;
}

interface PlacedAbutment {
  station: number;
  /** Seat elevation. */
  seat: number;
  /** +1: the section's x runs toward higher stations; −1: toward lower ones. */
  back: 1 | -1;
  body: P2[];
  footing: P2[];
}

function deckDepthOf(bridge: CorridorBridge) {
  const b = profileBounds(bridge.deck.profile);
  return { minY: b.minY, maxY: b.maxY, depth: Math.max(b.maxY - b.minY, 0.3) };
}

/** Where a bridge's two abutments stand, with their sections. */
function placeAbutments(bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null): { start: PlacedAbutment; end: PlacedAbutment } {
  const deck = deckDepthOf(bridge);
  const make = (a: AbutmentSpec, station: number, forward: boolean): PlacedAbutment => {
    const p = alignment.pointAt(station);
    const seat = profile.elevationAt(station) + bridge.deck.offset[1] + deck.minY;
    const ground = terrain?.elevationAt(p.x, p.y) ?? null;
    const height = autoHeight(a) && ground !== null ? seat - (ground - 1) : null;
    // x runs back into the embankment: behind the start abutment, ahead of the end one.
    const back = ((forward ? -1 : 1) * (a.mirror ? -1 : 1)) as 1 | -1;
    return { station, seat, back, ...abutmentSections(a, height, deck.depth) };
  };
  return { start: make(bridge.start, Math.min(bridge.from, bridge.to), true), end: make(bridge.end, Math.max(bridge.from, bridge.to), false) };
}

/** The two abutments of a bridge (start, end) as closed solids, storey-local metres. */
export function abutmentSolids(
  bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null,
): { start: BridgeAbutmentSolids; end: BridgeAbutmentSolids } {
  const placed = placeAbutments(bridge, alignment, profile, terrain);
  const solid = (pl: PlacedAbutment, a: AbutmentSpec): BridgeAbutmentSolids => {
    const p = alignment.pointAt(pl.station);
    const ex: V3 = [Math.cos(p.direction) * pl.back, Math.sin(p.direction) * pl.back, 0];
    const right: V3 = [Math.sin(p.direction), -Math.cos(p.direction), 0];
    const origin: V3 = [p.x, p.y, pl.seat];
    return {
      body: extrudeOutline(pl.body, origin, ex, [0, 0, 1], right, -a.left, a.right),
      footing: extrudeOutline(pl.footing, origin, ex, [0, 0, 1], right, -a.left - 0.3, a.right + 0.3),
      height: -Math.min(...pl.body.map((q) => q[1])),
    };
  };
  return { start: solid(placed.start, bridge.start), end: solid(placed.end, bridge.end) };
}

/** A bridge drawn in elevation along its alignment: points are (station, elevation). */
export interface BridgeElevation {
  deck: P2[];
  abutments: { body: P2[]; footing: P2[]; height: number }[];
  grade: P2[];
  ground: P2[];
}

/** The bridge seen from the side, unrolled along the alignment, with the road and the ground a little beyond it. */
export function bridgeElevation(bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null): BridgeElevation {
  const deck = deckDepthOf(bridge);
  const placed = placeAbutments(bridge, alignment, profile, terrain);
  const lo = placed.start.station, hi = placed.end.station;
  const sample = (a: number, b: number) => {
    const n = Math.max(2, Math.ceil((b - a) / 1));
    return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (i / n));
  };
  const top = sample(lo, hi).map((s): P2 => [s, profile.elevationAt(s) + bridge.deck.offset[1] + deck.maxY]);
  const soffit = sample(lo, hi).reverse().map((s): P2 => [s, profile.elevationAt(s) + bridge.deck.offset[1] + deck.minY]);
  const reach = Math.max(...[placed.start, placed.end].flatMap((pl) => [...pl.body, ...pl.footing].map((q) => Math.abs(q[0])))) + 10;
  const around = sample(Math.max(alignment.startStation, lo - reach), Math.min(alignment.endStation, hi + reach));
  const ground = terrain ? around.flatMap((s): P2[] => { const p = alignment.pointAt(s); const z = terrain.elevationAt(p.x, p.y); return z === null ? [] : [[s, z]]; }) : [];
  const unroll = (pl: PlacedAbutment, loop: P2[]) => loop.map(([x, y]): P2 => [pl.station + pl.back * x, pl.seat + y]);
  return {
    deck: [...top, ...soffit],
    abutments: [placed.start, placed.end].map((pl) => ({ body: unroll(pl, pl.body), footing: unroll(pl, pl.footing), height: -Math.min(...pl.body.map((q) => q[1])) })),
    grade: around.map((s): P2 => [s, profile.elevationAt(s)]),
    ground,
  };
}
