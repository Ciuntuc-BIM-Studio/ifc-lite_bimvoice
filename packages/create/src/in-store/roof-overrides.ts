/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system's own edits to single parts, kept by part key (the Tag a
 * regeneration matches parts by): a part deleted, a member's section, a
 * member lengthened or shortened at either end, the cut at each end — square
 * to the member, plumb (vertical) or level (horizontal) — and a part's
 * colour. They survive regeneration as long as their part is still
 * generated; an override whose part is gone is dropped.
 *
 * Members with a non-square end are solids of their own (`memberSolidFaces`):
 * the section swept along the axis, each end cut by its plane.
 */

import type { RoofMember, RoofStructureSpec } from './roof-structure.js';

type Vec3 = [number, number, number];

export type EndCut = 'square' | 'plumb' | 'level';
export const END_CUTS: readonly EndCut[] = ['square', 'plumb', 'level'];

export interface RoofPartOverride {
  deleted?: boolean;
  /** Section, metres (members). */
  width?: number;
  depth?: number;
  /** Along the member's axis at its start / end, metres; negative shortens. */
  extendStart?: number;
  extendEnd?: number;
  startCut?: EndCut;
  endCut?: EndCut;
  /** #rrggbb. */
  color?: string;
}

export type RoofOverrides = Record<string, RoofPartOverride>;

export interface ShapedMember extends RoofMember {
  startCut: EndCut;
  endCut: EndCut;
  color?: string;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const RAFTERS = new Set(['rafter', 'hip', 'valley', 'chord']);

/** The members as built: overrides applied, deleted ones left out; rafters take the structure's end cuts unless overridden. */
export function shapeMembers(members: readonly RoofMember[], structure: RoofStructureSpec, overrides: RoofOverrides = {}): ShapedMember[] {
  const out: ShapedMember[] = [];
  for (const m of members) {
    const o = overrides[m.key] ?? {};
    if (o.deleted) continue;
    const ends = RAFTERS.has(m.role) ? structure.rafterEnds : undefined;
    const u = unit(sub(m.end, m.start));
    const start = o.extendStart ? sub(m.start, mul(u, o.extendStart)) : m.start;
    const end = o.extendEnd ? add(m.end, mul(u, o.extendEnd)) : m.end;
    out.push({
      ...m, start, end,
      width: o.width && o.width > 0 ? o.width : m.width,
      depth: o.depth && o.depth > 0 ? o.depth : m.depth,
      startCut: o.startCut ?? ends?.eave ?? 'square',
      endCut: o.endCut ?? ends?.ridge ?? 'square',
      ...(o.color ? { color: o.color } : {}),
    });
  }
  return out;
}

/** Overrides of parts no longer generated dropped; empty ones too. */
export function pruneOverrides(overrides: RoofOverrides | undefined, keys: ReadonlySet<string>): RoofOverrides | undefined {
  if (!overrides) return undefined;
  const out: RoofOverrides = {};
  for (const [key, o] of Object.entries(overrides)) {
    if (keys.has(key) && Object.values(o).some((v) => v !== undefined && v !== false)) out[key] = o;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The plane an end is cut by: its point and normal (pointing out of the member). */
function endPlane(at: Vec3, axis: Vec3, cut: EndCut, outward: 1 | -1): { p: Vec3; n: Vec3 } {
  const horizontal = Math.hypot(axis[0], axis[1]);
  let n: Vec3 = axis;
  if (cut === 'plumb' && horizontal > 1e-6) n = [axis[0] / horizontal, axis[1] / horizontal, 0];
  if (cut === 'level' && Math.abs(axis[2]) > 1e-6) n = [0, 0, Math.sign(axis[2])];
  return { p: at, n: mul(n, outward) };
}

/**
 * A member as a closed solid: its section (width across, depth square to the
 * axis in the vertical plane through it) along the axis, each end on its cut
 * plane. Faces counter-clockwise seen from outside, in the same frame as the
 * member's points.
 */
export function memberSolidFaces(m: Pick<ShapedMember, 'start' | 'end' | 'width' | 'depth' | 'startCut' | 'endCut'>): Vec3[][] {
  const u = unit(sub(m.end, m.start));
  const across = Math.hypot(u[0], u[1]) > 1e-6 ? unit(cross(u, [0, 0, 1])) : ([1, 0, 0] as Vec3);
  const up = unit(cross(across, u));
  const hw = m.width / 2, hd = m.depth / 2;
  // Section corners around the axis, counter-clockwise looking along +u.
  const offsets: Vec3[] = [add(mul(across, -hw), mul(up, -hd)), add(mul(across, hw), mul(up, -hd)), add(mul(across, hw), mul(up, hd)), add(mul(across, -hw), mul(up, hd))];
  const onPlane = (base: Vec3, plane: { p: Vec3; n: Vec3 }): Vec3 => {
    const denom = dot(u, plane.n);
    const t = Math.abs(denom) < 1e-9 ? 0 : dot(sub(plane.p, base), plane.n) / denom;
    return add(base, mul(u, t));
  };
  const s = endPlane(m.start, u, m.startCut, -1), e = endPlane(m.end, u, m.endCut, 1);
  const a = offsets.map((o) => onPlane(add(m.start, o), s));
  const b = offsets.map((o) => onPlane(add(m.end, o), e));
  // The start face looks back along −u, the end face along +u, the sides outwards.
  const faces: Vec3[][] = [[a[0], a[1], a[2], a[3]], [b[3], b[2], b[1], b[0]]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    faces.push([a[i], b[i], b[j], a[j]]);
  }
  return faces;
}
