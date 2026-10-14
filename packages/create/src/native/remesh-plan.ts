/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which edited elements the native mesher can rebuild exactly, and the
 * solids to send it (N3, `meshNativeElements`). Only what the native path
 * reproduces exactly is planned; everything else is left to the IFC remesh
 * with the reason:
 *
 *  - walls, slabs, beams and columns whose body is a plain extrusion (no roof
 *    trim, no clipping) and that take part in no `IfcRelInterferesElements`
 *    (Studio subtractions, cut priorities);
 *  - their openings are axis-aligned boxes in the host's frame (an arched or
 *    turned cut is left to the IFC path, which cuts it exactly).
 *
 * Solids are placed in the model's IFC frame, metres: the element's own
 * parameters (lifted as for the native model) under its parent placement's
 * world frame (`worldFrame`).
 */

import { StoreEditor, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from '../in-store/resolve-anchor.js';
import { readWallJoinTarget } from '../in-store/wall-join-read.js';
import { resolveSlabEditChain } from '../in-store/edit/slab-edit.js';
import { resolveLinearElementChain } from '../in-store/edit/linear-element-edit.js';
import { readElementPlacement } from '../in-store/element-relocate.js';
import { placedBodyExtent } from '../in-store/resolve-host.js';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';
import { localFrame, worldFrame } from '../in-store/placement-3d.js';
import { parentPlacementOf } from '../in-store/element-transform-frames.js';
import type { ProfileSection } from '../in-store/profile.js';
import { wallBodyOutline } from '../in-store/wall-join.js';
import { encodeNativeSolids, type NativeSolidSpec } from './solids.js';
import { ringArea2 } from './validate.js';

export interface NativeRemeshPlan {
  /** Planned elements, in the buffer's order. */
  expressIds: number[];
  /** Their IFC class, as the mesher names it (`IfcWall`, ...). */
  ifcTypes: string[];
  /** `meshNativeElements`' solids buffer (one solid per planned element). */
  buffer: Float64Array;
  /** Elements left to the IFC remesh, with why. */
  fallback: Map<number, string>;
}

const CLASS: Record<string, string> = {
  IFCWALL: 'IfcWall', IFCWALLSTANDARDCASE: 'IfcWallStandardCase', IFCSLAB: 'IfcSlab', IFCBEAM: 'IfcBeam', IFCCOLUMN: 'IfcColumn',
};

type V3 = [number, number, number];
type Ref = (value: unknown) => number | null;

const refId: Ref = (value) => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return typeof value === 'string' && /^#[1-9][0-9]*$/.test(value) ? Number(value.slice(1)) : null;
};

/** Column-major matrix of a frame (rotation rows `r`, translation `t`). */
function matrix(r: number[][], t: V3): number[] {
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, t[0], t[1], t[2], 1];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const planTurn = (x: number, y: number, z: number, angle: number) =>
  [Math.cos(angle), Math.sin(angle), 0, 0, -Math.sin(angle), Math.cos(angle), 0, 0, 0, 0, 1, 0, x, y, z, 1];

interface Context {
  store: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
  reader: AnchorEntityReader;
  scale: number;
  /** Host express id -> the openings voiding it. */
  openingsOf: Map<number, number[]>;
  /** Elements in an IfcRelInterferesElements. */
  interfering: Set<number>;
}

function context(store: IfcDataStore, view: MutablePropertyView): Context {
  const reader = new AnchorEntityReader(store, view);
  const openingsOf = new Map<number, number[]>();
  for (const relId of reader.ids('IFCRELVOIDSELEMENT')) {
    const rel = reader.entity(relId);
    const host = refId(rel?.attributes[4]), opening = refId(rel?.attributes[5]);
    if (host === null || opening === null) continue;
    openingsOf.set(host, [...(openingsOf.get(host) ?? []), opening]);
  }
  const interfering = new Set<number>();
  for (const relId of reader.ids('IFCRELINTERFERESELEMENTS')) {
    const rel = reader.entity(relId);
    for (const at of [4, 5]) { const id = refId(rel?.attributes[at]); if (id !== null) interfering.add(id); }
  }
  return { store, view, editor: new StoreEditor(store, view), reader, scale: getModelLengthUnitScale(store), openingsOf, interfering };
}

/** The element's first Body item, when it is a plain extrusion. */
function plainExtrusion(ctx: Context, expressId: number): number | null {
  const shape = ctx.reader.entity(refId(ctx.reader.entity(expressId)?.attributes[6]) ?? -1);
  const reps = shape?.attributes[2];
  if (!Array.isArray(reps)) return null;
  for (const ref of reps) {
    const rep = ctx.reader.entity(refId(ref) ?? -1);
    if (rep?.attributes[1] !== 'Body') continue;
    const items = rep.attributes[3];
    if (!Array.isArray(items) || items.length !== 1) return null;
    const item = refId(items[0]);
    return item !== null && ctx.reader.entity(item)?.type.toUpperCase() === 'IFCEXTRUDEDAREASOLID' ? item : null;
  }
  return null;
}

/** The world frame of the element's parent placement, as a column-major matrix. */
function parentWorld(ctx: Context, expressId: number): number[] | null {
  const placement = refId(ctx.reader.entity(expressId)?.attributes[5]);
  const parent = placement === null ? null : parentPlacementOf({ dataStore: ctx.store, view: ctx.view }, placement);
  if (parent === null) return translate(0, 0, 0);
  const frame = worldFrame({ dataStore: ctx.store, view: ctx.view }, parent);
  return frame ? matrix(frame.r, frame.t as V3) : null;
}

/** The element's own placement frame in its parent's (metres), as a column-major matrix. */
function ownFrame(ctx: Context, expressId: number): number[] | null {
  const placement = refId(ctx.reader.entity(expressId)?.attributes[5]);
  const frame = placement === null ? null : localFrame({ dataStore: ctx.store, view: ctx.view }, placement);
  return frame ? matrix(frame.r, frame.t as V3) : null;
}

/** An opening's cut as a box in its host's frame (metres), or a reason it is not one. */
function boxCut(ctx: Context, openingId: number, hostFrame: number[]): NativeSolidSpec | string {
  const item = plainExtrusion(ctx, openingId);
  const solid = item === null ? null : ctx.reader.entity(item);
  const profile = solid ? ctx.reader.entity(refId(solid.attributes[0]) ?? -1) : null;
  if (profile?.type.toUpperCase() !== 'IFCRECTANGLEPROFILEDEF') return 'an opening that is not a rectangular cut';
  const placement = readElementPlacement(ctx.store, ctx.editor, openingId);
  const square = (deg: number) => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-9;
  if (!placement || !square(placement.rx) || !square(placement.ry) || !square(placement.rz)) return 'a turned opening';
  const bounds = placedBodyExtent(ctx.store, openingId, ctx.view);
  if (!bounds) return 'an opening whose cut cannot be read';
  const [min, max] = [bounds.min.map((v) => v * ctx.scale), bounds.max.map((v) => v * ctx.scale)];
  return {
    profile: { kind: 'polygon', outer: [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]] },
    placement: multiply(hostFrame, translate(0, 0, min[2])),
    depth: max[2] - min[2],
  };
}

/** The host's cuts, or a reason the native path cannot make them. */
function cutsOf(ctx: Context, hostId: number, hostFrame: number[]): NativeSolidSpec[] | string {
  const cuts: NativeSolidSpec[] = [];
  for (const openingId of ctx.openingsOf.get(hostId) ?? []) {
    if (!ctx.reader.entity(openingId)) continue;
    const cut = boxCut(ctx, openingId, hostFrame);
    if (typeof cut === 'string') return cut;
    cuts.push(cut);
  }
  return cuts;
}

function wallSolid(ctx: Context, id: number, world: number[]): NativeSolidSpec | string {
  const read = readWallJoinTarget(ctx.store, ctx.view, id, ctx.scale);
  if (!read || !Number.isFinite(read.height)) return 'a wall that is not a straight extrusion';
  if (plainExtrusion(ctx, id) !== read.solidId) return 'a trimmed or clipped wall body';
  const own = ownFrame(ctx, id);
  if (!own) return 'a wall whose placement cannot be read';
  const frame = multiply(world, own);
  const w = read.wall;
  const outline = wallBodyOutline(w);
  // The axis starts `a0` along the placement's X (the start the lift reads, minus its origin).
  const a0 = Math.hypot(w.start[0] - read.origin[0], w.start[1] - read.origin[1])
    * Math.sign((w.start[0] - read.origin[0]) * (w.end[0] - w.start[0]) + (w.start[1] - read.origin[1]) * (w.end[1] - w.start[1]) || 1);
  const cuts = cutsOf(ctx, id, frame);
  if (typeof cuts === 'string') return cuts;
  return {
    profile: { kind: 'polygon', outer: outline.corners.map(([x, y]) => [x, y]) },
    placement: multiply(frame, translate(a0, 0, 0)), depth: read.height, ...(cuts.length ? { cuts } : {}),
  };
}

function slabSolid(ctx: Context, id: number, world: number[]): NativeSolidSpec | string {
  const chain = resolveSlabEditChain(ctx.store, ctx.view, ctx.editor, id, ctx.scale);
  if (!chain || chain.baseElevation === null || plainExtrusion(ctx, id) !== chain.extrudedSolidId) return 'a slab that is not a vertical extrusion of its outline';
  let outer = chain.footprint.map((p) => [p[0], p[1]] as [number, number]);
  if (ringArea2(outer) < 0) outer = outer.reverse();
  const base = chain.extrusionUp ? chain.baseElevation : chain.baseElevation - chain.thickness;
  // The slab's openings are placed in its own frame.
  const own = ownFrame(ctx, id);
  if (!own) return 'a slab whose placement cannot be read';
  const cuts = cutsOf(ctx, id, multiply(world, own));
  if (typeof cuts === 'string') return cuts;
  return { profile: { kind: 'polygon', outer }, placement: multiply(world, translate(0, 0, base)), depth: chain.thickness, ...(cuts.length ? { cuts } : {}) };
}

function linearSolid(ctx: Context, id: number, world: number[]): NativeSolidSpec | string {
  const chain = resolveLinearElementChain(ctx.store, ctx.view, ctx.editor, id, ctx.scale);
  if (!chain || plainExtrusion(ctx, id) !== chain.extrudedSolidId) return 'a member that is not a section extruded along an axis';
  if ((ctx.openingsOf.get(id) ?? []).length) return 'a member with openings';
  const section: ProfileSection = chain.profile ?? { Type: 'Rectangle', XDim: chain.profileWidth, YDim: chain.profileHeight };
  const own = ownFrame(ctx, id);
  if (!own) return 'a member whose placement cannot be read';
  return { profile: { kind: 'section', section }, placement: multiply(world, own), depth: chain.depth };
}

/**
 * Plan the native remesh of `expressIds`. `eligible(id)` lets the caller veto
 * an element (e.g. one drawn with several meshes, one per material layer).
 */
export function planNativeRemesh(
  store: IfcDataStore,
  view: MutablePropertyView,
  expressIds: Iterable<number>,
  eligible: (expressId: number) => string | null = () => null,
): NativeRemeshPlan {
  const ctx = context(store, view);
  const solids: NativeSolidSpec[] = [];
  const plan: NativeRemeshPlan = { expressIds: [], ifcTypes: [], buffer: new Float64Array(), fallback: new Map() };
  for (const id of expressIds) {
    const type = ctx.reader.entity(id)?.type.toUpperCase() ?? '';
    const ifcClass = CLASS[type];
    const veto = !ifcClass ? 'not a wall, slab, beam or column' : ctx.interfering.has(id) ? 'cut by or cutting another element' : eligible(id);
    const world = veto ? null : parentWorld(ctx, id);
    const solid = veto ?? (!world ? 'a placement chain that cannot be read'
      : type === 'IFCSLAB' ? slabSolid(ctx, id, world)
        : type === 'IFCBEAM' || type === 'IFCCOLUMN' ? linearSolid(ctx, id, world)
          : wallSolid(ctx, id, world));
    if (typeof solid === 'string') { plan.fallback.set(id, solid); continue; }
    solids.push(solid);
    plan.expressIds.push(id);
    plan.ifcTypes.push(ifcClass);
  }
  plan.buffer = encodeNativeSolids(solids);
  return plan;
}
