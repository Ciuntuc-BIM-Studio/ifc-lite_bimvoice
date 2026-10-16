/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A plain extrusion read back as a solid's history (N3): an element whose
 * Body is one IfcExtrudedAreaSolid of a polygon or rectangle (with or
 * without voids), extruded along its own Z, placed on its storey — what
 * Lapin's plate, simple roof, member and footing tools write, and much of
 * an imported model. Its `extrude` shape is the profile and the solid's
 * frame carried into the storey's, in metres; nothing else is guessed.
 */

import type { LiftContext } from './lift-base.js';
import { axis2d, axis3d, pointOf, refId } from '../in-store/host-geometry-frame.js';
import { localFrame } from '../in-store/placement-3d.js';
import { combinationOf } from '../in-store/body-trim.js';
import type { NativeSolidShape, PlanPoint } from './schema.js';

type V3 = [number, number, number];
const EPS = 1e-9;

/** A polyline's points (closing repeat dropped), native units. */
function polyline(ctx: LiftContext, ref: unknown): PlanPoint[] | null {
  const curve = ctx.reader.entity(refId(ref) ?? -1);
  if (curve?.type.toUpperCase() !== 'IFCPOLYLINE' || !Array.isArray(curve.attributes[0])) return null;
  const pts: PlanPoint[] = [];
  for (const p of curve.attributes[0] as unknown[]) {
    const v = pointOf(ctx.reader, p, 'IFCCARTESIANPOINT', 2);
    if (!v) return null;
    pts.push([v[0], v[1]]);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < EPS) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** The profile's outer ring and holes, in its own frame, native units; null for any other profile. */
function profileRings(ctx: LiftContext, ref: unknown): { outer: PlanPoint[]; holes: PlanPoint[][] } | null {
  const profile = ctx.reader.entity(refId(ref) ?? -1);
  const type = profile?.type.toUpperCase();
  if (!profile) return null;
  if (type === 'IFCARBITRARYCLOSEDPROFILEDEF' || type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
    const outer = polyline(ctx, profile.attributes[2]);
    const holes = type === 'IFCARBITRARYPROFILEDEFWITHVOIDS' && Array.isArray(profile.attributes[3])
      ? (profile.attributes[3] as unknown[]).map((h) => polyline(ctx, h)) : [];
    return outer && holes.every((h) => h !== null) ? { outer, holes: holes as PlanPoint[][] } : null;
  }
  if (type === 'IFCRECTANGLEPROFILEDEF') {
    const at = axis2d(ctx.reader, profile.attributes[2]);
    const [w, h] = [Number(profile.attributes[3]), Number(profile.attributes[4])];
    if (!at || !(w > 0) || !(h > 0)) return null;
    const [ox, oy] = at.o, [xx, xy] = at.x;
    const place = (u: number, v: number): PlanPoint => [ox + u * xx - v * xy, oy + u * xy + v * xx];
    return { outer: [place(-w / 2, -h / 2), place(w / 2, -h / 2), place(w / 2, h / 2), place(-w / 2, h / 2)], holes: [] };
  }
  return null;
}

const mul = (r: number[][], v: readonly number[]): V3 => [0, 1, 2].map((i) => r[i][0] * v[0] + r[i][1] * v[1] + r[i][2] * v[2]) as V3;

/** `expressId`'s plain extrusion as an `extrude` history in its storey's frame, or null. */
export function extrusionShape(ctx: LiftContext, expressId: number, storeyPlacement: number | null): NativeSolidShape | null {
  const entity = ctx.reader.entity(expressId);
  const shape = ctx.reader.entity(refId(entity?.attributes[6]) ?? -1);
  const reps = Array.isArray(shape?.attributes[2]) ? (shape!.attributes[2] as unknown[]) : [];
  const body = reps.map((r) => ctx.reader.entity(refId(r) ?? -1)).find((r) => r?.attributes[1] === 'Body');
  const items = Array.isArray(body?.attributes[3]) ? (body!.attributes[3] as unknown[]) : [];
  // A body combined in Studio (Union / Intersect) is its own extrusion first.
  let item = items.length === 1 ? refId(items[0]) : null;
  const read = (id: number) => ctx.reader.entity(id);
  while (item !== null && combinationOf(read, item)) item = refId(read(item)!.attributes[1]);
  const solid = item === null ? null : ctx.reader.entity(item);
  if (solid?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') return null;
  // Extruded along the solid's own +Z only.
  const dir = pointOf(ctx.reader, solid.attributes[2], 'IFCDIRECTION');
  if (!dir || Math.abs(dir[0]) > EPS || Math.abs(dir[1]) > EPS || dir[2] <= 0) return null;
  const depth = Number(solid.attributes[3]) * ctx.scale;
  const rings = profileRings(ctx, solid.attributes[0]);
  const at = axis3d(ctx.reader, solid.attributes[1]);
  // Placed straight on its storey.
  const placementId = refId(entity?.attributes[5]);
  const placement = placementId === null ? null : ctx.reader.entity(placementId);
  if (!rings || !at || !(depth > 0) || placementId === null || refId(placement?.attributes[0]) !== storeyPlacement) return null;
  const local = localFrame({ dataStore: ctx.store, view: ctx.view }, placementId);
  if (!local) return null;
  const s = ctx.scale;
  const ring = (r: PlanPoint[]): PlanPoint[] => r.map(([x, y]) => [x * s, y * s]);
  const o = mul(local.r, [at.o[0] * s, at.o[1] * s, at.o[2] * s]);
  return {
    operation: 'extrude', outer: ring(rings.outer), ...(rings.holes.length ? { holes: rings.holes.map(ring) } : {}), depth,
    location: [local.t[0] + o[0], local.t[1] + o[1], local.t[2] + o[2]], axis: mul(local.r, at.z), refDirection: mul(local.r, at.x),
  };
}
