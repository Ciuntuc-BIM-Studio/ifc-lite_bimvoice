/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Faceted bodies for the native mesher (N3): an IfcFacetedBrep read as a
 * `faces` solid (a rafter with cut ends, a sloped roof plane), and a roof
 * trim (`wall-roof-trim.ts`: DIFFERENCE clippings by
 * IfcPolygonalBoundedHalfSpace) read as the closed prisms it takes off the
 * wall: each boundary polygon, between the roof plane and a lid well past
 * the body, on the side the half space's material lies.
 */

import { axis3d, pointOf, refId, type GeometryEntityReader, type Vec3 } from '../in-store/host-geometry-frame.js';
import type { NativeSolidSpec, SolidFace, SpacePoint } from './solids.js';

const word = (v: unknown) => (typeof v === 'string' ? v.replace(/\./g, '').toUpperCase() : v === true ? 'T' : v === false ? 'F' : '');

/** A face loop's points, native units, in its bound's orientation. */
function loopPoints(reader: GeometryEntityReader, boundId: number | null, scale: number): SpacePoint[] | null {
  const bound = boundId === null ? null : reader.entity(boundId);
  const type = bound?.type.toUpperCase();
  if (!bound || (type !== 'IFCFACEOUTERBOUND' && type !== 'IFCFACEBOUND')) return null;
  const loop = reader.entity(refId(bound.attributes[0]) ?? -1);
  if (loop?.type.toUpperCase() !== 'IFCPOLYLOOP' || !Array.isArray(loop.attributes[0])) return null;
  const points: SpacePoint[] = [];
  for (const ref of loop.attributes[0]) {
    const p = pointOf(reader, ref);
    if (!p) return null;
    points.push([p[0] * scale, p[1] * scale, p[2] * scale]);
  }
  return word(bound.attributes[1]) === 'F' ? points.reverse() : points;
}

/** IfcFacetedBrep `itemId` as a `faces` solid placed by `frame` (metres); or a reason. */
export function brepSolid(reader: GeometryEntityReader, itemId: number, frame: readonly number[], scale: number): NativeSolidSpec | string {
  const brep = reader.entity(itemId);
  const shell = brep?.type.toUpperCase() === 'IFCFACETEDBREP' ? reader.entity(refId(brep.attributes[0]) ?? -1) : null;
  if (!shell || shell.type.toUpperCase() !== 'IFCCLOSEDSHELL' || !Array.isArray(shell.attributes[0])) return 'a faceted body that cannot be read';
  const faces: SolidFace[] = [];
  for (const ref of shell.attributes[0]) {
    const face = reader.entity(refId(ref) ?? -1);
    const bounds = face?.type.toUpperCase() === 'IFCFACE' ? face.attributes[0] : null;
    if (!Array.isArray(bounds) || bounds.length === 0) return 'a faceted body face that cannot be read';
    const loops = bounds.map((b) => ({ outer: reader.entity(refId(b) ?? -1)?.type.toUpperCase() === 'IFCFACEOUTERBOUND', points: loopPoints(reader, refId(b), scale) }));
    if (loops.some((l) => !l.points)) return 'a faceted body loop that cannot be read';
    const outerAt = Math.max(0, loops.findIndex((l) => l.outer));
    faces.push({ outer: loops[outerAt].points!, holes: loops.filter((_, k) => k !== outerAt).map((l) => l.points!) });
  }
  return faces.length >= 4 ? { profile: { kind: 'faces', faces }, placement: [...frame], depth: 0 } : 'a faceted body with too few faces';
}

/** Twice the signed plan area of a loop (x, y). */
const area2 = (ring: readonly SpacePoint[]) => ring.reduce((sum, p, i) => {
  const q = ring[(i + 1) % ring.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0);

/**
 * The closed prism over the plan loop `ring` (metres) between `low(p)` and
 * `high(p)` at each point, outward faces.
 */
function prism(ring: SpacePoint[], low: (p: SpacePoint) => number, high: (p: SpacePoint) => number): SolidFace[] {
  const loop = area2(ring) < 0 ? [...ring].reverse() : ring;
  const bottom = loop.map((p): SpacePoint => [p[0], p[1], low(p)]);
  const top = loop.map((p): SpacePoint => [p[0], p[1], high(p)]);
  const faces: SolidFace[] = [{ outer: [...bottom].reverse() }, { outer: top }];
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    faces.push({ outer: [bottom[i], bottom[j], top[j], top[i]] });
  }
  return faces;
}

/** How far past the roof plane the removed prism reaches (metres): beyond any body it trims. */
const LID = 50;

/**
 * A roof-trimmed body: the extrusion inside its clippings (by id) and the
 * prisms the clippings take off, placed by `frame` (metres); or a reason.
 */
export function roofTrimCuts(reader: GeometryEntityReader, itemId: number, frame: readonly number[], scale: number): { inner: number; cuts: NativeSolidSpec[] } | string {
  const cuts: NativeSolidSpec[] = [];
  let id = itemId;
  for (;;) {
    const clip = reader.entity(id);
    if (clip?.type.toUpperCase() !== 'IFCBOOLEANCLIPPINGRESULT') break;
    if (word(clip.attributes[0]) !== 'DIFFERENCE') return 'a clipping that is not a difference';
    const half = reader.entity(refId(clip.attributes[2]) ?? -1);
    if (half?.type.toUpperCase() !== 'IFCPOLYGONALBOUNDEDHALFSPACE') return 'a clipping by an unbounded half space';
    const plane = reader.entity(refId(half.attributes[0]) ?? -1);
    const at = plane?.type.toUpperCase() === 'IFCPLANE' ? axis3d(reader, plane.attributes[0]) : null;
    const boundaryFrame = axis3d(reader, half.attributes[2]);
    const curve = reader.entity(refId(half.attributes[3]) ?? -1);
    if (!at || !boundaryFrame || curve?.type.toUpperCase() !== 'IFCPOLYLINE' || !Array.isArray(curve.attributes[0])) return 'a roof trim that cannot be read';
    // The boundary must stand straight in the body's frame (what the roof trim writes).
    const straight = (v: Vec3, w: Vec3) => Math.abs(v[0] - w[0]) + Math.abs(v[1] - w[1]) + Math.abs(v[2] - w[2]) < 1e-9;
    if (!straight(boundaryFrame.x, [1, 0, 0]) || !straight(boundaryFrame.z, [0, 0, 1])) return 'a roof trim bounded off the vertical';
    const n = at.z;
    if (Math.abs(n[2]) < 1e-6) return 'a roof trim by a vertical plane';
    const ring: SpacePoint[] = [];
    for (const ref of curve.attributes[0]) {
      const p = pointOf(reader, ref, 'IFCCARTESIANPOINT', 2);
      if (!p) return 'a roof trim boundary that cannot be read';
      ring.push([(p[0] + boundaryFrame.o[0]) * scale, (p[1] + boundaryFrame.o[1]) * scale, 0]);
    }
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    if (ring.length < 3) return 'a degenerate roof trim boundary';
    const o = at.o.map((v) => v * scale);
    const onPlane = (p: SpacePoint) => o[2] - (n[0] * (p[0] - o[0]) + n[1] * (p[1] - o[1])) / n[2];
    // AgreementFlag FALSE: the half space (what is taken off) lies on the side the normal points to.
    const above = (word(half.attributes[1]) === 'F') === n[2] > 0;
    const faces = above ? prism(ring, onPlane, (p) => onPlane(p) + LID) : prism(ring, (p) => onPlane(p) - LID, onPlane);
    cuts.push({ profile: { kind: 'faces', faces }, placement: [...frame], depth: 0 });
    const inner = refId(clip.attributes[1]);
    if (inner === null) return 'a roof trim that cannot be read';
    id = inner;
  }
  return { inner: id, cuts };
}
