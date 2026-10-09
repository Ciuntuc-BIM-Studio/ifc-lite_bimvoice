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
  /** Quarter cones of embankment at its two sides (default on). */
  cones?: boolean;
}

export type PierType = 'wall' | 'columns';

/**
 * An intermediate pier, square across the alignment at its station: a wall
 * (blade) pier, or a row of columns under a pier cap; on a continuous
 * footing. Its top carries the bearings under the deck's soffit.
 */
export interface PierSpec {
  id: string;
  station: number;
  type: PierType;
  /** Across the road from the alignment (the wall's, or the cap's, ends), metres. */
  left: number;
  right: number;
  /** Along the road: the wall's thickness, or a column's size (diameter / side). */
  thickness: number;
  /** Columns: how many, and their section. */
  columns: number;
  shape: 'round' | 'square';
  /** Pier cap (columns): depth and width along the road. */
  cap: { depth: number; width: number };
  /** Down to a metre under the ground (default); false: `height`. */
  autoHeight?: boolean;
  /** Top of the pier to the footing's top, metres (used without terrain too). */
  height: number;
  footing: { width: number; thickness: number };
}

/** The bearings under the deck at every support (abutment seats and pier tops): a line of pads across. */
export interface BearingSpec {
  count: number;
  /** Across, along the road, and high, metres. */
  width: number;
  length: number;
  height: number;
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
  /** Intermediate piers, by station. */
  piers?: PierSpec[];
  /** Absent: the deck sits straight on the supports. */
  bearings?: BearingSpec;
}

export const defaultBearings = (): BearingSpec => ({ count: 4, width: 0.5, length: 0.4, height: 0.15 });

/** A pier at a station, `halfWidth` either side of the axis. */
export function defaultPier(id: string, station: number, halfWidth: number, type: PierType = 'columns'): PierSpec {
  return type === 'wall'
    ? { id, station, type, left: halfWidth - 0.5, right: halfWidth - 0.5, thickness: 1.2, columns: 1, shape: 'square', cap: { depth: 0, width: 1.2 }, autoHeight: true, height: 8, footing: { width: 4, thickness: 1.2 } }
    : { id, station, type, left: halfWidth - 0.5, right: halfWidth - 0.5, thickness: 1.2, columns: Math.max(2, Math.round((2 * halfWidth) / 5)), shape: 'round', cap: { depth: 1.2, width: 1.8 }, autoHeight: true, height: 8, footing: { width: 4, thickness: 1.2 } };
}

/** `n` piers dividing the bridge into equal spans (the existing ones' settings carried over). */
export function distributePiers(bridge: CorridorBridge, spans: number, halfWidth: number, freshId: () => string): PierSpec[] {
  const lo = Math.min(bridge.from, bridge.to), hi = Math.max(bridge.from, bridge.to);
  const old = bridge.piers ?? [];
  return Array.from({ length: Math.max(0, Math.round(spans) - 1) }, (_, i) => {
    const station = Math.round((lo + ((hi - lo) * (i + 1)) / Math.round(spans)) * 1000) / 1000;
    const like = old[Math.min(i, old.length - 1)];
    return like ? { ...structuredClone(like), id: old[i]?.id ?? freshId(), station } : defaultPier(freshId(), station, halfWidth);
  });
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

export interface PlacedAbutment {
  station: number;
  /** Seat elevation. */
  seat: number;
  /** +1: the section's x runs toward higher stations; −1: toward lower ones. */
  back: 1 | -1;
  body: P2[];
  footing: P2[];
}

export function deckDepthOf(bridge: CorridorBridge) {
  const b = profileBounds(bridge.deck.profile);
  return { minY: b.minY, maxY: b.maxY, depth: Math.max(b.maxY - b.minY, 0.3) };
}

/** The bearings' height (0 without bearings). */
export const bearingHeight = (bridge: CorridorBridge) => (bridge.bearings && bridge.bearings.count > 0 ? Math.max(bridge.bearings.height, 0.02) : 0);

/** The deck's soffit on the axis at a station. */
export function soffitAt(bridge: CorridorBridge, profile: VerticalProfile, station: number): number {
  return profile.elevationAt(station) + bridge.deck.offset[1] + deckDepthOf(bridge).minY;
}

/** How far the seat reaches back from the front face before the back wall (where the deck rests), less a 5 cm joint. */
export function seatLength(pl: PlacedAbutment): number {
  const up = pl.body.filter((q) => q[1] > 1e-6).map((q) => q[0]);
  return up.length ? Math.max(Math.min(...up) - 0.05, 0) : 0;
}

/** Where a bridge's two abutments stand, with their sections (the seat under the bearings). */
export function placeAbutments(bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null): { start: PlacedAbutment; end: PlacedAbutment } {
  const deck = deckDepthOf(bridge);
  const make = (a: AbutmentSpec, station: number, forward: boolean): PlacedAbutment => {
    const p = alignment.pointAt(station);
    const seat = soffitAt(bridge, profile, station) - bearingHeight(bridge);
    const ground = terrain?.elevationAt(p.x, p.y) ?? null;
    const height = autoHeight(a) && ground !== null ? seat - (ground - 1) : null;
    // x runs back into the embankment: behind the start abutment, ahead of the end one.
    const back = ((forward ? -1 : 1) * (a.mirror ? -1 : 1)) as 1 | -1;
    return { station, seat, back, ...abutmentSections(a, height, deck.depth + bearingHeight(bridge)) };
  };
  return { start: make(bridge.start, Math.min(bridge.from, bridge.to), true), end: make(bridge.end, Math.max(bridge.from, bridge.to), false) };
}
