/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plain IfcExtrudedAreaSolid read as a native solid (N3): the profile
 * (a rectangle or a closed polyline, in its own 2D position), the solid's
 * Position, and an extrusion straight along that position's Z. What a door
 * or window without a joinery type is drawn from, and any other element
 * whose body is one such extrusion. A typed door or window maps its type's
 * extrusions (`mappedSolids`): each is one part, through the mapped item's
 * operator, a mirror included.
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
export function outline(reader: GeometryEntityReader, profileId: number | null): PlanPoint[] | string {
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
  const placement = multiply(outer, frame);
  // A scaled frame (a mapped item's scale factors): the scale goes into the profile and the
  // depth, the frame kept rigid; one that shears the solid is not built.
  const length3 = (c: number) => Math.hypot(placement[c * 4], placement[c * 4 + 1], placement[c * 4 + 2]);
  const [sx, sy, sz] = [length3(0), length3(1), length3(2)];
  const column = (c: number) => [placement[c * 4], placement[c * 4 + 1], placement[c * 4 + 2]];
  if (Math.min(sx, sy, sz) < 1e-12) return 'an extrusion placed by a degenerate frame';
  const [c0, c1, c2] = [column(0), column(1), column(2)];
  if (Math.abs(dot(c0, c1)) > 1e-9 * sx * sy || Math.abs(dot(c0, c2)) > 1e-9 * sx * sz || Math.abs(dot(c1, c2)) > 1e-9 * sy * sz) return 'an extrusion placed by a shearing frame';
  for (let k = 0; k < 3; k++) { placement[k] /= sx; placement[4 + k] /= sy; placement[8 + k] /= sz; }
  let outer2 = ring.map(([u, v]): PlanPoint => [u * scale * sx, v * scale * sy]);
  // A mirroring placement (a mapped item's left-handed operator): flip the profile's X and the
  // frame's with it, the same body in a right-handed frame the mesher's fast paths can trust.
  if (determinant(placement) < 0) {
    for (let k = 0; k < 3; k++) placement[k] = -placement[k];
    outer2 = outer2.map(([u, v]): PlanPoint => [-u, v]);
  }
  if (ringArea2(outer2) < 0) outer2 = outer2.reverse();
  return { profile: { kind: 'polygon', outer: outer2 }, placement, depth: depth * scale * sz };
}

/** True when `ring` is a rectangle with its edges along the axes (a box cut seen from above). */
export function isAxisRectangle(ring: readonly PlanPoint[]): boolean {
  if (ring.length !== 4) return false;
  const eps = 1e-9 * Math.max(1, ...ring.flat().map(Math.abs));
  return ring.every((p, i) => {
    const q = ring[(i + 1) % 4];
    return Math.abs(p[0] - q[0]) <= eps || Math.abs(p[1] - q[1]) <= eps;
  }) && Math.abs(ringArea2(ring)) > eps;
}

/** Of the 3x3 part of a column-major 4x4. */
function determinant(m: readonly number[]): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * IfcCartesianTransformationOperator3D (or its nonUniform subtype) as a
 * column-major matrix, translation in metres: orthonormal axes, each scaled
 * by its factor (a mirror allowed); null for anything else.
 */
function operatorMatrix(reader: GeometryEntityReader, operatorId: number | null, scale: number): number[] | null {
  const op = operatorId === null ? null : reader.entity(operatorId);
  const type = op?.type.toUpperCase();
  if (!op || (type !== 'IFCCARTESIANTRANSFORMATIONOPERATOR3D' && type !== 'IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM')) return null;
  const axis = (at: number, fallback: [number, number, number]) => {
    if (op.attributes[at] === null || op.attributes[at] === undefined) return fallback;
    const d = pointOf(reader, op.attributes[at], 'IFCDIRECTION');
    const len = d ? Math.hypot(d[0], d[1], d[2]) : 0;
    return d && len > 1e-12 ? [d[0] / len, d[1] / len, d[2] / len] as [number, number, number] : null;
  };
  const [a1, a2, a3] = [axis(0, [1, 0, 0]), axis(1, [0, 1, 0]), axis(4, [0, 0, 1])];
  const origin = pointOf(reader, op.attributes[2]);
  const factor = (at: number, fallback: number) => (op.attributes[at] === null || op.attributes[at] === undefined ? fallback : numeric(op.attributes[at]));
  const s1 = factor(3, 1);
  const [s2, s3] = type === 'IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM' && s1 !== null ? [factor(5, s1), factor(6, s1)] : [s1, s1];
  if (!a1 || !a2 || !a3 || !origin || s1 === null || s2 === null || s3 === null || s1 <= 0 || s2 <= 0 || s3 <= 0) return null;
  if (Math.abs(dot(a1, a2)) > 1e-9 || Math.abs(dot(a1, a3)) > 1e-9 || Math.abs(dot(a2, a3)) > 1e-9) return null;
  const col = (a: readonly number[], f: number) => [a[0] * f, a[1] * f, a[2] * f, 0];
  return [...col(a1, s1), ...col(a2, s2), ...col(a3, s3), origin[0] * scale, origin[1] * scale, origin[2] * scale, 1];
}

/** The inverse of a rigid column-major 4x4 (rotation transposed). */
function rigidInverse(m: readonly number[]): number[] {
  const t = [m[12], m[13], m[14]];
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0];
  const inv = (row: number) => -(r[row] * t[0] + r[4 + row] * t[1] + r[8 + row] * t[2]);
  return [...r, inv(0), inv(1), inv(2), 1];
}

/** One part of a mapped body: its solid and the representation item it is drawn from. */
export interface MappedPart { solid: NativeSolidSpec; item: number }

/**
 * The parts of IfcMappedItem `itemId` placed by `outer`: every item of the
 * mapped representation must be a plain extrusion; or a reason.
 */
export function mappedSolids(reader: GeometryEntityReader, itemId: number, outer: readonly number[], scale: number): MappedPart[] | string {
  const mapped = reader.entity(itemId);
  const map = mapped?.type.toUpperCase() === 'IFCMAPPEDITEM' ? reader.entity(refId(mapped.attributes[0]) ?? -1) : null;
  if (!mapped || map?.type.toUpperCase() !== 'IFCREPRESENTATIONMAP') return 'a body that is not a mapped item';
  const operator = operatorMatrix(reader, refId(mapped.attributes[1]), scale);
  const origin = axis3d(reader, map.attributes[0]);
  if (!operator || !origin) return 'a mapped item whose transformation is not a scaled rigid one';
  const { o, x, y, z } = origin;
  const originMatrix = [...x, 0, ...y, 0, ...z, 0, o[0] * scale, o[1] * scale, o[2] * scale, 1];
  const frame = multiply(multiply(outer, operator), rigidInverse(originMatrix));
  const rep = reader.entity(refId(map.attributes[1]) ?? -1);
  const items = rep?.type.toUpperCase() === 'IFCSHAPEREPRESENTATION' ? rep.attributes[3] : null;
  if (!Array.isArray(items) || items.length === 0) return 'a mapped representation that cannot be read';
  const parts: MappedPart[] = [];
  for (const ref of items) {
    const item = refId(ref);
    const solid = item === null ? 'a mapped item that cannot be read' : extrusionSolid(reader, item, frame, scale);
    if (typeof solid === 'string') return solid;
    parts.push({ solid, item: item! });
  }
  return parts;
}
