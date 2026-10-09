/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Corridor components: library profiles swept along the corridor over a
 * station range — a retaining wall at the edge of a cut, a box tunnel round
 * the road, a bridge deck under it, barriers, kerbs, ditches. A component
 * carries a copy of its profile (so the corridor regenerates from the model
 * alone) and says where it is placed at every station:
 *
 * - `side` left / right: the profile's +x points away from the road on that
 *   side; centre: +x points right;
 * - `attach` edge: the finished-grade outer edge of that side (centre: the
 *   axis); axis: the centreline at grade; plus an `offset` (across, up);
 * - `daylight`: whether the earthwork slopes go on that side ('side'),
 *   on both ('both': a tunnel, a bridge) or stay ('keep');
 * - `autoHeight` (a preset with a height): the profile is regenerated at
 *   each station so its top meets the ground — a wall that follows the cut.
 */

import { PROFILE_PRESETS, regenerateProfile, type P2, type StructureKind, type StructureProfile } from './structure-profile.js';
import { triangulateWithHoles } from './triangulate.js';
import type { Terrain, V3 } from './tin.js';

export type ComponentSide = 'left' | 'right' | 'centre';
export type ComponentAttach = 'edge' | 'axis';
export type ComponentDaylight = 'keep' | 'side' | 'both';

export interface CorridorComponent {
  id: string;
  /** The library profile it was taken from (to refresh it). */
  profileId: string;
  profile: StructureProfile;
  side: ComponentSide;
  attach: ComponentAttach;
  /** Across (away from the road / to the right) and up, metres. */
  offset: [number, number];
  from: number;
  to: number;
  daylight: ComponentDaylight;
  autoHeight?: boolean;
  /** Mirrored about the profile's own vertical axis (x → −x), before the offset. */
  mirror?: boolean;
  /** Flipped about the profile's own horizontal axis (y → −y), before the offset. */
  flip?: boolean;
}

/** What a component's placement looks like at one station. */
export interface StationFrame {
  station: number;
  /** The attach point, world (storey-local) metres. */
  origin: V3;
  /** Unit vector across, horizontal: away from the road (left / right) or to the right (centre). */
  across: [number, number];
}

export function defaultDaylight(kind: StructureKind): ComponentDaylight {
  return kind === 'tunnel' || kind === 'bridge-deck' ? 'both' : kind === 'retaining-wall' ? 'side' : 'keep';
}

export function defaultSide(kind: StructureKind): ComponentSide {
  return kind === 'tunnel' || kind === 'bridge-deck' ? 'centre' : 'right';
}

/** Whether a component takes away the daylight slope of `side` at `station`. */
export function suppressesDaylight(c: CorridorComponent, station: number, side: 'left' | 'right'): boolean {
  if (station < Math.min(c.from, c.to) - 1e-9 || station > Math.max(c.from, c.to) + 1e-9) return false;
  if (c.daylight === 'both') return true;
  return c.daylight === 'side' && (c.side === side || c.side === 'centre');
}

/** The profile at a station: as stored, or re-heighted so its top meets the ground. */
function profileAt(c: CorridorComponent, frame: StationFrame, terrain: Terrain | null): StructureProfile {
  const preset = c.profile.preset;
  if (!c.autoHeight || !terrain || !preset || !PROFILE_PRESETS[preset.id].params.some((p) => p.key === 'height')) return c.profile;
  // The ground at the profile's back (its widest point away from the road).
  const xs = c.profile.outer.map((p) => (c.mirror ? -p[0] : p[0]));
  const back = Math.max(...xs) + c.offset[0];
  const x = frame.origin[0] + frame.across[0] * back, y = frame.origin[1] + frame.across[1] * back;
  const ground = terrain.elevationAt(x, y);
  if (ground === null) return c.profile;
  const height = ground - (frame.origin[2] + c.offset[1]);
  return regenerateProfile({ ...c.profile, preset: { id: preset.id, params: { ...preset.params, height } } });
}

/** A profile point at a station frame, world. */
function place(frame: StationFrame, c: CorridorComponent, p: P2): V3 {
  const a = (c.mirror ? -p[0] : p[0]) + c.offset[0], up = (c.flip ? -p[1] : p[1]) + c.offset[1];
  return [frame.origin[0] + frame.across[0] * a, frame.origin[1] + frame.across[1] * a, frame.origin[2] + up];
}

/** The component's section at a station, as loops in (offset across from the axis, elevation) — for section drawings. */
export function componentSection(c: CorridorComponent, frame: StationFrame, axis: V3, right: [number, number], terrain: Terrain | null): P2[][] {
  const p = profileAt(c, frame, terrain);
  const o = (q: V3): P2 => [(q[0] - axis[0]) * right[0] + (q[1] - axis[1]) * right[1], q[2]];
  return [p.outer, ...p.holes].map((loop) => loop.map((q) => o(place(frame, c, q))));
}

export interface SweptComponent {
  points: V3[];
  triangles: [number, number, number][];
}

/**
 * Sweep a component through its station frames (in order): one ring per
 * loop per frame, quads between frames, the end caps triangulated with
 * their holes. Faces point outward (the shell's signed volume is positive).
 */
export function sweepComponent(c: CorridorComponent, frames: readonly StationFrame[], terrain: Terrain | null): SweptComponent | null {
  if (frames.length < 2) return null;
  const sections = frames.map((f) => profileAt(c, f, terrain));
  const loops = [sections[0].outer, ...sections[0].holes];
  // Every frame must have the same vertex counts (a preset keeps its topology across heights).
  if (sections.some((s) => s.outer.length !== loops[0].length || s.holes.length !== loops.length - 1 || s.holes.some((h, i) => h.length !== loops[i + 1].length))) return null;
  const per = loops.reduce((n, l) => n + l.length, 0);
  const points: V3[] = [];
  frames.forEach((f, i) => {
    for (const loop of [sections[i].outer, ...sections[i].holes]) for (const q of loop) points.push(place(f, c, q));
  });
  const triangles: [number, number, number][] = [];
  let start = 0;
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i + 1 < frames.length; i++) {
      for (let j = 0; j < n; j++) {
        const a0 = i * per + start + j, a1 = i * per + start + (j + 1) % n, b0 = (i + 1) * per + start + j, b1 = (i + 1) * per + start + (j + 1) % n;
        triangles.push([a0, b0, b1], [a0, b1, a1]);
      }
    }
    start += n;
  }
  const cap = triangulateWithHoles(sections[0].outer, sections[0].holes);
  const last = (frames.length - 1) * per;
  for (const [x, y, z] of cap) {
    // The sides run each loop backwards at the first ring: the first cap runs it forwards, the last backwards.
    triangles.push([x, y, z]);
    triangles.push([last + x, last + z, last + y]);
  }
  // Outward faces: flip everything if the shell came out inside-out (a mirrored frame, a reversed range).
  let volume = 0;
  for (const [i, j, k] of triangles) {
    const a = points[i], b = points[j], d = points[k];
    volume += a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0]);
  }
  if (volume < 0) for (const t of triangles) [t[1], t[2]] = [t[2], t[1]];
  return { points, triangles };
}

/** A component of a library profile with the defaults its kind calls for. */
export function componentFromProfile(id: string, profile: StructureProfile, from: number, to: number): CorridorComponent {
  return {
    id, profileId: profile.id, profile: structuredClone(profile), side: defaultSide(profile.kind), attach: 'edge', offset: [0, 0], from, to,
    daylight: defaultDaylight(profile.kind), autoHeight: profile.kind === 'retaining-wall' && !!profile.preset,
  };
}
