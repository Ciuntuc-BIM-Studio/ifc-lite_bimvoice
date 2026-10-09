/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Points spanning an element's body, read from its IFC records (no meshing):
 * the corners of an extrusion's profile at both ends, a brep's vertices,
 * a mapped item's through its operator, a boolean result's first operand.
 * Enough for an element's centre (flips) and its extent (cut priorities);
 * native length units, in the frame of the representation the items sit in.
 */

import { applyFrame, axis2d, axis3d, pointOf, refId, type Frame3, type Vec3 } from './host-geometry-frame.js';
import type { AnchorEntityReader } from './resolve-anchor.js';

type Reader = AnchorEntityReader;

/** A numeric attribute as read back: a number, a REAL `{ real }`, or a typed `{ typed: { value } }`. */
export function numeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object') {
    if ('real' in v && typeof (v as { real: unknown }).real === 'number') return (v as { real: number }).real;
    if ('typed' in v) return numeric((v as { typed: { value: unknown } }).typed.value);
  }
  return null;
}
export const upper = (e: { type: string } | null) => e?.type.toUpperCase() ?? '';

/** Points spanning a profile (its own 2D frame applied); a parameterised profile is centred on its Position (IFC4). */
export function profilePoints(r: Reader, profileId: number | null, depth = 0): [number, number][] {
  const profile = profileId === null ? null : r.entity(profileId);
  if (!profile || depth > 8) return [];
  const type = upper(profile);
  if (type === 'IFCARBITRARYCLOSEDPROFILEDEF' || type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') return curvePoints(r, refId(profile.attributes[2]));
  if (type === 'IFCDERIVEDPROFILEDEF') return profilePoints(r, refId(profile.attributes[2]), depth + 1);
  const frame = axis2d(r, profile.attributes[2]);
  if (!frame) return [];
  const at = (x: number, y: number): [number, number] => [
    frame.o[0] + frame.x[0] * x - frame.x[1] * y,
    frame.o[1] + frame.x[1] * x + frame.x[0] * y,
  ];
  const a = numeric(profile.attributes[3]), b = numeric(profile.attributes[4]);
  if ((type === 'IFCRECTANGLEPROFILEDEF' || type === 'IFCROUNDEDRECTANGLEPROFILEDEF') && a !== null && b !== null) {
    return [at(-a / 2, -b / 2), at(a / 2, -b / 2), at(a / 2, b / 2), at(-a / 2, b / 2)];
  }
  if ((type === 'IFCCIRCLEPROFILEDEF' || type === 'IFCCIRCLEHOLLOWPROFILEDEF') && a !== null) return [at(-a, -a), at(a, a)];
  return [at(0, 0)];
}

export function curvePoints(r: Reader, curveId: number | null): [number, number][] {
  const curve = curveId === null ? null : r.entity(curveId);
  if (!curve) return [];
  if (upper(curve) === 'IFCPOLYLINE' && Array.isArray(curve.attributes[0])) {
    return curve.attributes[0].map((p) => pointOf(r, p, 'IFCCARTESIANPOINT', 2)).filter((p): p is Vec3 => !!p).map((p) => [p[0], p[1]]);
  }
  if (upper(curve) === 'IFCINDEXEDPOLYCURVE') {
    const list = r.entity(refId(curve.attributes[0]) ?? -1);
    const coords = Array.isArray(list?.attributes[0]) ? list.attributes[0] : [];
    return coords.filter((c): c is number[] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number').map((c) => [c[0], c[1]]);
  }
  return [];
}

/** IfcCartesianTransformationOperator3D(nonUniform) as a frame (axes scaled). */
export function operatorFrame(r: Reader, opId: number | null): Frame3 | null {
  const op = opId === null ? null : r.entity(opId);
  if (!op) return null;
  const dir = (v: unknown, d: Vec3): Vec3 => (v === null || v === undefined ? d : pointOf(r, v, 'IFCDIRECTION') ?? d);
  const o = pointOf(r, op.attributes[2]) ?? [0, 0, 0];
  const s = numeric(op.attributes[3]) ?? 1;
  const s2 = numeric(op.attributes[5]) ?? s, s3 = numeric(op.attributes[6]) ?? s;
  const x = dir(op.attributes[0], [1, 0, 0]), y = dir(op.attributes[1], [0, 1, 0]), z = dir(op.attributes[4], [0, 0, 1]);
  return { o, x: x.map((v) => v * s) as Vec3, y: y.map((v) => v * s2) as Vec3, z: z.map((v) => v * s3) as Vec3 };
}

/** Points spanning a representation item, in its representation's frame. */
export function itemPoints(r: Reader, itemId: number | null, depth: number): Vec3[] {
  const item = itemId === null ? null : r.entity(itemId);
  if (!item || depth > 16) return [];
  const type = upper(item);
  if (type === 'IFCEXTRUDEDAREASOLID' || type === 'IFCEXTRUDEDAREASOLIDTAPERED') {
    const frame = axis3d(r, item.attributes[1]);
    const d = pointOf(r, item.attributes[2], 'IFCDIRECTION');
    const len = numeric(item.attributes[3]) ?? 0;
    if (!frame || !d) return [];
    return profilePoints(r, refId(item.attributes[0])).flatMap(([x, y]) => [
      applyFrame(frame, [x, y, 0]), applyFrame(frame, [x + d[0] * len, y + d[1] * len, d[2] * len]),
    ]);
  }
  if (type === 'IFCREVOLVEDAREASOLID') {
    const frame = axis3d(r, item.attributes[1]);
    return frame ? profilePoints(r, refId(item.attributes[0])).map(([x, y]) => applyFrame(frame, [x, y, 0])) : [];
  }
  if (type === 'IFCFACETEDBREP' || type === 'IFCFACETEDBREPWITHVOIDS') {
    const shell = r.entity(refId(item.attributes[0]) ?? -1);
    const out: Vec3[] = [];
    for (const face of Array.isArray(shell?.attributes[0]) ? shell.attributes[0] : []) {
      for (const bound of r.entity(refId(face) ?? -1)?.attributes[0] as unknown[] ?? []) {
        const loop = r.entity(refId(r.entity(refId(bound) ?? -1)?.attributes[0]) ?? -1);
        for (const p of Array.isArray(loop?.attributes[0]) ? loop.attributes[0] : []) {
          const v = pointOf(r, p);
          if (v) out.push(v);
        }
      }
    }
    return out;
  }
  if (type === 'IFCBOOLEANCLIPPINGRESULT' || type === 'IFCBOOLEANRESULT') return itemPoints(r, refId(item.attributes[1]), depth + 1);
  if (type === 'IFCMAPPEDITEM') {
    const map = r.entity(refId(item.attributes[0]) ?? -1);
    const origin = map ? (upper(r.entity(refId(map.attributes[0]) ?? -1)) === 'IFCAXIS2PLACEMENT3D' ? axis3d(r, map.attributes[0]) : null) : null;
    const op = operatorFrame(r, refId(item.attributes[1]));
    const rep = map ? r.entity(refId(map.attributes[1]) ?? -1) : null;
    const pts = (Array.isArray(rep?.attributes[3]) ? rep.attributes[3] : []).flatMap((i) => itemPoints(r, refId(i), depth + 1));
    return pts.map((p) => (op ? applyFrame(op, origin ? applyFrame(origin, p) : p) : p));
  }
  return [];
}

/** The plan centre of a representation's items (element-local), or the origin when nothing is readable. */
export function repCentre(r: Reader, repId: number): [number, number] {
  const rep = r.entity(repId);
  const pts = (Array.isArray(rep?.attributes[3]) ? rep.attributes[3] : []).flatMap((i) => itemPoints(r, refId(i), 0));
  if (pts.length === 0) return [0, 0];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** Body points of an element in its own placement frame: its Body representation's items (else its first non-axis one). */
export function elementBodyPoints(r: Reader, elementId: number): Vec3[] {
  const shape = r.entity(refId(r.entity(elementId)?.attributes[6]) ?? -1);
  const reps = (Array.isArray(shape?.attributes[2]) ? shape.attributes[2] : []).map((v) => r.entity(refId(v) ?? -1)).filter((x) => x !== null);
  const body = reps.find((rep) => rep!.attributes[1] === 'Body') ?? reps.find((rep) => !['Axis', 'FootPrint', 'Box', 'Annotation'].includes(String(rep!.attributes[1])));
  return (Array.isArray(body?.attributes[3]) ? body.attributes[3] : []).flatMap((i) => itemPoints(r, refId(i), 0));
}
