/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A pergola along a path, built as the members it is made of rather than
 * swept as one section: posts either side of the path (IfcColumn), evenly
 * spaced over the component's stations at no more than the post spacing; a
 * beam along each row of posts, following the path's curves and grade
 * (IfcBeam); and joists across on top, evenly spaced at no more than the
 * joist spacing, overhanging the beams (IfcBeam JOIST). The posts stand on
 * the path's grade at the axis; heights are clear heights above it.
 */

import { box, type AxisFrame } from './bridge-piers.js';
import { sweepComponent, type CorridorComponent, type StationFrame } from './components.js';
import type { StructureProfile } from './structure-profile.js';
import type { V3 } from './tin.js';

export interface PergolaPart {
  key: string;
  name: string;
  color: string;
  ifc: Pick<StructureProfile, 'ifcClass' | 'predefinedType' | 'objectType'>;
  points: V3[];
  triangles: [number, number, number][];
}

export const isPergola = (c: CorridorComponent): boolean => c.profile.kind === 'pergola' && c.profile.preset?.id === 'timber-pergola';

/** `n + 1` evenly spaced stations over [from, to], no further apart than `spacing`. */
function evenly(from: number, to: number, spacing: number): number[] {
  const n = Math.max(1, Math.ceil((to - from) / spacing - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}

/** A station frame as a box frame: along the path, across it, at z 0. */
function axisFrame(f: StationFrame, c: CorridorComponent): AxisFrame {
  const sign = c.side === 'left' ? -1 : 1;
  const r: V3 = [f.across[0] * sign, f.across[1] * sign, 0];
  return { o: [f.origin[0], f.origin[1], 0], t: [-r[1], r[0], 0], r };
}

/**
 * The pergola's members over the stations of its frames (`frames`, the
 * component's station frames in order; `frameAt`, a frame at any station
 * of its range).
 */
export function pergolaParts(c: CorridorComponent, frames: readonly StationFrame[], frameAt: (station: number) => StationFrame): PergolaPart[] {
  if (frames.length < 2 || !c.profile.preset) return [];
  const { width: W, height: H, post: p, postSpacing, beamDepth: bd, joistWidth: jw, joistDepth: jd, joistSpacing, overhang: o } = c.profile.preset.params;
  const from = frames[0].station, to = frames[frames.length - 1].station;
  const material = { color: c.profile.color };
  const [dx, dz] = c.offset;
  const rows = [{ side: 'L', at: -W / 2 - p / 2 + dx }, { side: 'R', at: W / 2 + p / 2 + dx }];
  const parts: PergolaPart[] = [];

  // Posts: both rows, on the grade at each station, up to the beams.
  const posts = evenly(from, to, postSpacing);
  posts.forEach((s, i) => {
    const f = frameAt(s), a = axisFrame(f, c), z0 = f.origin[2] + dz;
    // The end posts stand inside the range, flush with its ends.
    const lo = i === 0 ? 0 : i === posts.length - 1 ? -p : -p / 2, hi = lo + p;
    for (const row of rows) {
      const solid = box(a, lo, hi, row.at - p / 2, row.at + p / 2, z0, z0 + H);
      parts.push({ key: `comp:${c.id}:post:${row.side}:${i}`, name: `${c.profile.name} post ${row.side}${i + 1}`, ...material, ifc: { ifcClass: 'IfcColumn', predefinedType: 'COLUMN', objectType: 'Pergola post' }, ...solid });
    }
  });

  // Beams: one per row, swept along the path on top of the posts.
  for (const row of rows) {
    const rect: [number, number][] = [[row.at - dx - p / 2, H], [row.at - dx + p / 2, H], [row.at - dx + p / 2, H + bd], [row.at - dx - p / 2, H + bd]];
    const beam: CorridorComponent = { ...c, autoHeight: false, mirror: false, flip: false, tilt: undefined, profile: { ...c.profile, preset: undefined, outer: rect, holes: [] } };
    const swept = sweepComponent(beam, frames, null);
    if (swept) parts.push({ key: `comp:${c.id}:beam:${row.side}`, name: `${c.profile.name} beam ${row.side}`, ...material, ifc: { ifcClass: 'IfcBeam', predefinedType: 'BEAM', objectType: 'Pergola beam' }, ...swept });
  }

  // Joists: across on the beams, overhanging them.
  const reach = W / 2 + p + o;
  evenly(from + jw / 2, to - jw / 2, joistSpacing).forEach((s, i) => {
    const f = frameAt(s), a = axisFrame(f, c), z = f.origin[2] + dz + H + bd;
    const solid = box(a, -jw / 2, jw / 2, -reach + dx, reach + dx, z, z + jd);
    parts.push({ key: `comp:${c.id}:joist:${i}`, name: `${c.profile.name} joist ${i + 1}`, ...material, ifc: { ifcClass: 'IfcBeam', predefinedType: 'JOIST', objectType: 'Pergola joist' }, ...solid });
  });
  return parts;
}
