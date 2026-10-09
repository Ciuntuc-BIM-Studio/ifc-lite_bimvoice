/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridges in a corridor: over a station range the road runs on a deck (a
 * library profile swept on the axis — no earthworks there), carried at each
 * end by an abutment of one of two standard types, on a continuous (strip)
 * footing:
 *
 * - wall abutment: a front wall the depth of the drop, with a back wall
 *   (ballast wall) up to the deck's top behind the bearing seat;
 * - gravity abutment: a mass wall with a vertical front and a battered back,
 *   with the same back wall.
 *
 * An abutment's section lies in the alignment's vertical plane — x from its
 * front face back into the embankment, y up from the bearing seat (the
 * deck's soffit) — and is extruded straight across the road, `left` metres
 * to the left of the alignment and `right` to the right. The start abutment
 * looks forward along the road, the end one back; `mirror` turns one round.
 * Its height, unless given, reaches from the seat down to a metre below the
 * ground (the footing's top), or 6 m with no terrain.
 */

import type { HorizontalAlignment } from './alignment.js';
import type { VerticalProfile } from './profile.js';
import { profileBounds, type P2, type StructureProfile } from './structure-profile.js';
import { triangulateWithHoles } from './triangulate.js';
import type { Terrain, V3 } from './tin.js';

export type AbutmentType = 'wall' | 'gravity';

export interface AbutmentSpec {
  type: AbutmentType;
  /** Across the road from the alignment, metres. */
  left: number;
  right: number;
  /** Seat to footing top, metres; absent: from the terrain. */
  height?: number;
  /** Front (stem) thickness at the top, metres. */
  stem: number;
  /** Gravity abutment: base width; wall abutment: ignored. */
  base: number;
  /** Back (ballast) wall thickness. */
  backwall: number;
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
  /** The deck's profile (a library copy) and its offset from the axis at grade. */
  deck: { profileId: string; profile: StructureProfile; offset: [number, number] };
  start: AbutmentSpec;
  end: AbutmentSpec;
}

export function defaultAbutment(type: AbutmentType, halfWidth: number): AbutmentSpec {
  return type === 'wall'
    ? { type, left: halfWidth, right: halfWidth, stem: 1, base: 1, backwall: 0.4, footing: { width: 4, thickness: 1, toe: 1 } }
    : { type, left: halfWidth, right: halfWidth, stem: 1.2, base: 3, backwall: 0.4, footing: { width: 4.5, thickness: 1, toe: 0.5 } };
}

/** An abutment's section (x back from the front face, y up from the seat) and its footing's. */
export function abutmentSections(a: AbutmentSpec, height: number, deckDepth: number): { body: P2[]; footing: P2[] } {
  const H = Math.max(height, 0.5), t = Math.max(a.stem, 0.2), tb = Math.min(Math.max(a.backwall, 0.15), t), hb = Math.max(deckDepth, 0.3);
  const b = a.type === 'gravity' ? Math.max(a.base, t) : t;
  const body: P2[] = [[0, -H], [b, -H], [t, 0], [t, hb], [t - tb, hb], [t - tb, 0], [0, 0]];
  // A wall abutment's back is vertical: drop the repeated corner.
  const clean = body.filter((p, i) => i === 0 || p[0] !== body[i - 1][0] || p[1] !== body[i - 1][1]);
  const ft = Math.max(a.footing.thickness, 0.2), fw = Math.max(a.footing.width, b), toe = Math.min(Math.max(a.footing.toe, 0), fw - b);
  const footing: P2[] = [[-toe, -H - ft], [fw - toe, -H - ft], [fw - toe, -H], [-toe, -H]];
  return { body: clean, footing };
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
  height: number;
}

/** The two abutments of a bridge (start, end) as closed solids, storey-local metres. */
export function abutmentSolids(
  bridge: CorridorBridge, alignment: HorizontalAlignment, profile: VerticalProfile, terrain: Terrain | null,
): { start: BridgeAbutmentSolids; end: BridgeAbutmentSolids } {
  const deckBounds = profileBounds(bridge.deck.profile);
  const deckDepth = Math.max(deckBounds.maxY - deckBounds.minY, 0.3);
  const make = (a: AbutmentSpec, station: number, forward: boolean): BridgeAbutmentSolids => {
    const p = alignment.pointAt(station);
    const seat = profile.elevationAt(station) + bridge.deck.offset[1] + deckBounds.minY;
    const ground = terrain?.elevationAt(p.x, p.y) ?? null;
    const height = a.height ?? (ground !== null ? seat - (ground - 1) : 6);
    const { body, footing } = abutmentSections(a, height, deckDepth);
    const t: V3 = [Math.cos(p.direction), Math.sin(p.direction), 0];
    // x runs back into the embankment: behind the start abutment, ahead of the end one.
    const back = (forward ? -1 : 1) * (a.mirror ? -1 : 1);
    const ex: V3 = [t[0] * back, t[1] * back, 0];
    const right: V3 = [Math.sin(p.direction), -Math.cos(p.direction), 0];
    const origin: V3 = [p.x, p.y, seat];
    return {
      body: extrudeOutline(body, origin, ex, [0, 0, 1], right, -a.left, a.right),
      footing: extrudeOutline(footing, origin, ex, [0, 0, 1], right, -a.left - 0.3, a.right + 0.3),
      height,
    };
  };
  return { start: make(bridge.start, Math.min(bridge.from, bridge.to), true), end: make(bridge.end, Math.max(bridge.from, bridge.to), false) };
}
