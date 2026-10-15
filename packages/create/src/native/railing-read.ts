/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A railing read back as its builder's parameters (N3): the body
 * `addRailingToStore` writes — one IfcSweptDiskSolid handrail along an
 * IfcPolyline and a circular post (IfcExtrudedAreaSolid of an
 * IfcCircleProfileDef) at every vertex and every spacing step — gives its
 * path, height, rail and post diameters and post spacing exactly, in the
 * storey's frame, in metres. Any other body (a Studio railing, an imported
 * one) is not one, and nothing is guessed.
 */

import { railingPostPoints, type RailingInStoreParams } from '../in-store/railing.js';
import { axis3d, pointOf, refId } from '../in-store/host-geometry-frame.js';
import { numeric as num } from '../in-store/element-geometry-points.js';
import { localFrame } from '../in-store/placement-3d.js';
import type { LiftContext } from './lift-base.js';

type V3 = [number, number, number];
const EPS = 1e-6;
const round = (v: number) => Math.round(v * 1e9) / 1e9;
const near = (a: readonly number[], b: readonly number[], eps: number) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= eps;
const mul = (r: number[][], v: readonly number[]): V3 => [0, 1, 2].map((i) => r[i][0] * v[0] + r[i][1] * v[1] + r[i][2] * v[2]) as V3;

/** The posts per path segment (`railingPostPoints`' bays), or null when the posts do not walk the path. */
function baysOf(path: readonly V3[], posts: readonly V3[], eps: number): number[] | null {
  if (!posts.length || !near(posts[0], path[0], eps)) return null;
  const bays: number[] = [];
  let at = 1;
  for (let i = 1; i < path.length; i++) {
    const start = at;
    while (at < posts.length && !near(posts[at], path[i], eps)) at++;
    if (at === posts.length) return null;
    bays.push(++at - start);
  }
  return at === posts.length ? bays : null;
}

/**
 * A spacing (metres) that gives each segment its bays (`ceil(length / spacing)`):
 * any in [max(length / bays), min(length / (bays - 1))) does; the roundest one.
 */
function spacingFor(lengths: readonly number[], bays: readonly number[]): number {
  const lo = Math.max(...lengths.map((l, i) => l / bays[i]));
  const hi = Math.min(...lengths.map((l, i) => (bays[i] > 1 ? l / (bays[i] - 1) : Infinity)));
  for (const step of [0.1, 0.05, 0.01, 0.001]) {
    const v = Math.round(Math.ceil(lo / step - 1e-9) * step * 1e9) / 1e9;
    if (v >= lo - 1e-9 && v < hi - 1e-6) return v;
  }
  return round(lo);
}

/** `expressId`'s railing parameters, or null when its body is not the railing builder's. */
export function readRailing(ctx: LiftContext, expressId: number, storeyPlacement: number | null): RailingInStoreParams | null {
  const entity = ctx.reader.entity(expressId);
  const shape = ctx.reader.entity(refId(entity?.attributes[6]) ?? -1);
  const reps = Array.isArray(shape?.attributes[2]) ? (shape!.attributes[2] as unknown[]) : [];
  const body = reps.map((r) => ctx.reader.entity(refId(r) ?? -1)).find((r) => r?.attributes[1] === 'Body');
  const items = (Array.isArray(body?.attributes[3]) ? (body!.attributes[3] as unknown[]) : []).map((i) => ctx.reader.entity(refId(i) ?? -1));
  const [rail, ...postSolids] = items;
  if (rail?.type.toUpperCase() !== 'IFCSWEPTDISKSOLID' || !postSolids.length) return null;
  const directrix = ctx.reader.entity(refId(rail.attributes[0]) ?? -1);
  if (directrix?.type.toUpperCase() !== 'IFCPOLYLINE' || !Array.isArray(directrix.attributes[0])) return null;
  const axisLine = (directrix.attributes[0] as unknown[]).map((p) => pointOf(ctx.reader, p));
  const railRadius = num(rail.attributes[1]) ?? 0;
  if (axisLine.length < 2 || axisLine.some((p) => !p) || !(railRadius > 0) || (num(rail.attributes[2]) ?? 0) > 0) return null;

  // Every post: a circle of one radius, up the local Z to the rail's centreline.
  let postRadius = 0, axisHeight = 0;
  const posts: V3[] = [];
  for (const post of postSolids) {
    if (post?.type.toUpperCase() !== 'IFCEXTRUDEDAREASOLID') return null;
    const profile = ctx.reader.entity(refId(post.attributes[0]) ?? -1);
    const at = axis3d(ctx.reader, post.attributes[1]);
    const dir = pointOf(ctx.reader, post.attributes[2], 'IFCDIRECTION');
    const [radius, depth] = [num(profile?.attributes[3]) ?? 0, num(post.attributes[3]) ?? 0];
    if (profile?.type.toUpperCase() !== 'IFCCIRCLEPROFILEDEF' || !at || !dir || !(radius > 0) || !(depth > 0)) return null;
    if (Math.abs(dir[0]) > EPS || Math.abs(dir[1]) > EPS || dir[2] <= 0 || !near(at.z, [0, 0, 1], EPS)) return null;
    if (posts.length && (Math.abs(radius - postRadius) > EPS * radius || Math.abs(depth - axisHeight) > EPS * depth)) return null;
    [postRadius, axisHeight] = [radius, depth];
    posts.push(at.o as V3);
  }
  // The base line: the rail's centreline that far down, in the element's frame (native units).
  const path = axisLine.map((p) => [p![0], p![1], p![2] - axisHeight] as V3);
  const tolerance = EPS * Math.max(1, ...path.flat().map(Math.abs));
  const bays = baysOf(path, posts, tolerance);
  if (!bays) return null;
  const lengths = path.slice(1).map((b, i) => Math.hypot(b[0] - path[i][0], b[1] - path[i][1], b[2] - path[i][2]) * ctx.scale);
  const spacing = bays.some((n) => n > 1) ? spacingFor(lengths, bays) : undefined;
  const expected = railingPostPoints(path, spacing === undefined ? undefined : spacing / ctx.scale);
  if (expected.length !== posts.length || expected.some((p, i) => !near(p, posts[i], tolerance))) return null;

  // Placed straight on its storey, standing upright.
  const placementId = refId(entity?.attributes[5]);
  const placement = placementId === null ? null : ctx.reader.entity(placementId);
  if (placementId === null || refId(placement?.attributes[0]) !== storeyPlacement) return null;
  const local = localFrame({ dataStore: ctx.store, view: ctx.view }, placementId);
  if (!local || !near(mul(local.r, [0, 0, 1]), [0, 0, 1], EPS)) return null;
  const s = ctx.scale;
  const toStorey = (p: V3): [number, number, number] => {
    const q = mul(local.r, [p[0] * s, p[1] * s, p[2] * s]);
    return [round(local.t[0] + q[0]), round(local.t[1] + q[1]), round(local.t[2] + q[2])];
  };
  const railDiameter = round(2 * railRadius * s);
  const postDiameter = round(2 * postRadius * s);
  const predefined = typeof entity?.attributes[8] === 'string' ? (entity.attributes[8] as string).replace(/^\.|\.$/g, '') : undefined;
  return {
    Path: path.map(toStorey),
    Height: round((axisHeight + railRadius) * s),
    RailDiameter: railDiameter,
    ...(Math.abs(postDiameter - railDiameter) > 1e-9 ? { PostDiameter: postDiameter } : {}),
    ...(spacing !== undefined ? { PostSpacing: spacing } : {}),
    ...(predefined ? { PredefinedType: predefined } : {}),
  };
}
