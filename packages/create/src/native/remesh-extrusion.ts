/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plain IfcExtrudedAreaSolid read as a native solid (N3): the profile
 * (a rectangle or a closed polyline, in its own 2D position), the solid's
 * Position, and an extrusion straight along that position's Z. What a door
 * or window without a joinery type is drawn from, and any other element
 * whose body is one such extrusion.
 */

import { axis2d, axis3d, pointOf, refId, type GeometryEntityReader } from '../in-store/host-geometry-frame.js';
import type { PlanPoint } from './schema.js';
import type { NativeSolidSpec } from './solids.js';
import { ringArea2 } from './validate.js';

/** A number as parsed (bare) or authored (`{ real }`, `{ integer }`). */
export const numeric = (value: unknown): number | null => {
  const v = value && typeof value === 'object' && 'real' in value ? (value as { real: unknown }).real
    : value && typeof value === 'object' && 'integer' in value ? (value as { integer: unknown }).integer : value;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

export function multiply(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The profile's outline in the solid's XY, native units; or a reason. */
function outline(reader: GeometryEntityReader, profileId: number | null): PlanPoint[] | string {
  const profile = profileId === null ? null : reader.entity(profileId);
  const type = profile?.type.toUpperCase();
  if (type === 'IFCRECTANGLEPROFILEDEF') {
    const at = axis2d(reader, profile!.attributes[2]);
    const x = numeric(profile!.attributes[3]), y = numeric(profile!.attributes[4]);
    if (!at || x === null || y === null || x <= 0 || y <= 0) return 'a rectangle profile that cannot be read';
    const [ux, uy] = at.x;
    const corner = (u: number, v: number): PlanPoint => [at.o[0] + ux * u - uy * v, at.o[1] + uy * u + ux * v];
    return [corner(-x / 2, -y / 2), corner(x / 2, -y / 2), corner(x / 2, y / 2), corner(-x / 2, y / 2)];
  }
  if (type === 'IFCARBITRARYCLOSEDPROFILEDEF') {
    const curve = reader.entity(refId(profile!.attributes[2]) ?? -1);
    const refs = curve?.type.toUpperCase() === 'IFCPOLYLINE' ? curve.attributes[0] : null;
    if (!Array.isArray(refs)) return 'a profile whose outline is not a polyline';
    const ring: PlanPoint[] = [];
    for (const ref of refs) {
      const p = pointOf(reader, ref, 'IFCCARTESIANPOINT', 2);
      if (!p) return 'a profile outline that cannot be read';
      ring.push([p[0], p[1]]);
    }
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    return ring.length >= 3 ? ring : 'a degenerate profile outline';
  }
  return 'a profile that is not a rectangle or a closed polyline';
}

/**
 * The extrusion `itemId` as a native solid placed by `outer` (column-major,
 * the element's frame in metres), lengths scaled by `scale`; or a reason the
 * native path cannot build it.
 */
export function extrusionSolid(reader: GeometryEntityReader, itemId: number, outer: readonly number[], scale: number): NativeSolidSpec | string {
  const solid = reader.entity(itemId);
  if (solid?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') return 'a body that is not an extrusion';
  const ring = outline(reader, refId(solid.attributes[0]));
  if (typeof ring === 'string') return ring;
  const position = axis3d(reader, solid.attributes[1]);
  const direction = pointOf(reader, solid.attributes[2], 'IFCDIRECTION');
  const depth = numeric(solid.attributes[3]);
  if (!position || !direction || depth === null || depth <= 0) return 'an extrusion that cannot be read';
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-12 || Math.hypot(direction[0], direction[1]) / length > 1e-9 || direction[2] < 0) return 'an extrusion along a slanted direction';
  const { o, x, y, z } = position;
  const frame = [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0] * scale, o[1] * scale, o[2] * scale, 1];
  let outer2 = ring.map(([u, v]): PlanPoint => [u * scale, v * scale]);
  if (ringArea2(outer2) < 0) outer2 = outer2.reverse();
  return { profile: { kind: 'polygon', outer: outer2 }, placement: multiply(outer, frame), depth: depth * scale };
}
