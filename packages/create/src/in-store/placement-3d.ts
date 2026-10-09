/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Full 3D local placements: an `IfcLocalPlacement`'s frame in its parent's
 * frame (location, metres; rotation from Axis / RefDirection), read, chained
 * to the world, and written back as a fresh `IfcCartesianPoint` /
 * `IfcDirection`s / `IfcAxis2Placement3D` that the placement is repointed
 * to — so a point or direction shared with another product is never
 * changed under it.
 *
 * Rotations are given as angles about the parent's X, Y and Z axes,
 * applied in that order (R = Rz · Ry · Rx), degrees.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { asCoordinateTriple, asDirectionRatios, asExpressIdRef, readAttributes } from './edit/placement-core.js';
import { getModelLengthUnitScale } from './edit/length-unit-scale.js';
import { parentPlacementOf, type PlacementReader } from './element-transform-frames.js';

export type V3 = [number, number, number];
/** Rows of a rotation matrix. */
export type M3 = [V3, V3, V3];

/** A rigid frame: p ↦ R·p + t (metres). */
export interface Frame3D {
  r: M3;
  t: V3;
}

export const IDENTITY_3D: Frame3D = { r: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };

const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : a; };
const col = (m: M3, j: number): V3 => [m[0][j], m[1][j], m[2][j]];
const fromColumns = (x: V3, y: V3, z: V3): M3 => [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
const mulM = (a: M3, b: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i], col(b, j)))) as M3;
const mulV = (m: M3, v: readonly number[]): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const transpose = (m: M3): M3 => fromColumns(m[0], m[1], m[2]);

/** outer ∘ inner: inner's frame expressed in outer's parent. */
export function compose(outer: Frame3D, inner: Frame3D): Frame3D {
  const t = mulV(outer.r, inner.t);
  return { r: mulM(outer.r, inner.r), t: [t[0] + outer.t[0], t[1] + outer.t[1], t[2] + outer.t[2]] };
}

export function invert(f: Frame3D): Frame3D {
  const rt = transpose(f.r);
  const t = mulV(rt, f.t);
  return { r: rt, t: [-t[0], -t[1], -t[2]] };
}

/** The rotation of angles (radians) about X, then Y, then Z. */
export function rotationFromEuler(rx: number, ry: number, rz: number): M3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  const X: M3 = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Y: M3 = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Z: M3 = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  return mulM(Z, mulM(Y, X));
}

/** The X, Y, Z angles (radians) of a rotation (R = Rz · Ry · Rx). */
export function eulerFromRotation(r: M3): V3 {
  const sy = Math.max(-1, Math.min(1, -r[2][0]));
  const ry = Math.asin(sy);
  if (Math.abs(sy) > 1 - 1e-9) {
    // Gimbal lock: put the whole turn about Z.
    return [0, ry, Math.atan2(-r[0][1], r[1][1])];
  }
  return [Math.atan2(r[2][1], r[2][2]), ry, Math.atan2(r[1][0], r[0][0])];
}

const attrs = (r: PlacementReader, id: number) => readAttributes(r.dataStore, r.view, r.view, id);

/** An `IfcLocalPlacement`'s own frame in its parent's, metres; null when unreadable. */
export function localFrame(r: PlacementReader, placementId: number): Frame3D | null {
  const placement = attrs(r, placementId);
  const axisId = placement ? asExpressIdRef(placement[1]) : null;
  const axis = axisId === null ? null : attrs(r, axisId);
  const locationId = axis ? asExpressIdRef(axis[0]) : null;
  const location = locationId === null ? null : asCoordinateTriple(attrs(r, locationId)?.[0]);
  if (!axis || !location) return null;
  const scale = getModelLengthUnitScale(r.dataStore);
  const zId = asExpressIdRef(axis[1]), xId = asExpressIdRef(axis[2]);
  const z = norm((zId === null ? null : asDirectionRatios(attrs(r, zId)?.[0])) as V3 | null ?? [0, 0, 1]);
  const ref = (xId === null ? null : asDirectionRatios(attrs(r, xId)?.[0])) as V3 | null ?? [1, 0, 0];
  // RefDirection projected square to the Z axis (IFC's own rule).
  let x = norm([ref[0] - z[0] * dot(ref, z), ref[1] - z[1] * dot(ref, z), ref[2] - z[2] * dot(ref, z)]);
  if (Math.hypot(...x) < 1e-9) x = norm(Math.abs(z[0]) < 0.9 ? cross([0, 1, 0], z) : cross(z, [0, 0, 1]));
  const y = cross(z, x);
  const loc: V3 = [location[0] * scale, location[1] * scale, (location[2] ?? 0) * scale];
  return { r: fromColumns(x, y, z), t: loc };
}

/** A placement's frame in the world (the whole `PlacementRelTo` chain); null when a link is unreadable or loops. */
export function worldFrame(r: PlacementReader, placementId: number): Frame3D | null {
  let frame = IDENTITY_3D;
  const seen = new Set<number>();
  for (let id: number | null = placementId; id !== null; id = parentPlacementOf(r, id)) {
    if (seen.has(id)) return null;
    seen.add(id);
    const own = localFrame(r, id);
    if (!own) return null;
    frame = compose(own, frame);
  }
  return frame;
}

const isIdentity = (m: M3) => m.every((row, i) => row.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-12));
const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e12) / 1e12);

/**
 * Write a frame as the placement's new `IfcAxis2Placement3D` (fresh point and
 * directions; no axes for an unrotated frame), keeping its `PlacementRelTo`
 * unless `parentPlacementId` is given.
 */
export function writeLocalFrame(r: PlacementReader, editor: StoreEditor, placementId: number, frame: Frame3D, parentPlacementId?: number): void {
  const scale = getModelLengthUnitScale(r.dataStore);
  const point = editor.addEntity('IfcCartesianPoint', [frame.t.map((v) => clean(v / scale))]).expressId;
  const rotated = !isIdentity(frame.r);
  const axis = rotated ? `#${editor.addEntity('IfcDirection', [col(frame.r, 2).map(clean)]).expressId}` : null;
  const ref = rotated ? `#${editor.addEntity('IfcDirection', [col(frame.r, 0).map(clean)]).expressId}` : null;
  const placement3d = editor.addEntity('IfcAxis2Placement3D', [`#${point}`, axis, ref]).expressId;
  editor.setPositionalAttribute(placementId, 1, `#${placement3d}`);
  if (parentPlacementId !== undefined) editor.setPositionalAttribute(placementId, 0, `#${parentPlacementId}`);
}

/** A product's placement as the inspector shows it: offsets (metres) and angles (degrees) in its parent's frame. */
export interface PlacementTransform {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

const DEG = 180 / Math.PI;

export function transformOfFrame(f: Frame3D): PlacementTransform {
  const [rx, ry, rz] = eulerFromRotation(f.r);
  return { x: f.t[0], y: f.t[1], z: f.t[2], rx: rx * DEG, ry: ry * DEG, rz: rz * DEG };
}

export function frameOfTransform(t: PlacementTransform): Frame3D {
  return { r: rotationFromEuler(t.rx / DEG, t.ry / DEG, t.rz / DEG), t: [t.x, t.y, t.z] };
}
