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
import { extrusionSolid, isAxisRectangle, mappedSolids, multiply, numeric, outline, type MappedPart } from './remesh-extrusion.js';
import { localFrame, worldFrame } from '../in-store/placement-3d.js';
import { parentPlacementOf } from '../in-store/element-transform-frames.js';
import type { ProfileSection } from '../in-store/profile.js';
import { wallBodyOutline } from '../in-store/wall-join.js';
import { encodeNativeSolids, type NativeSolidSpec } from './solids.js';
import { ringArea2 } from './validate.js';

export interface NativeRemeshPlan {
  /**
   * Planned elements, one entry per solid in the buffer's order: an element
   * built of several parts (a joinery type's boxes) repeats its id.
   */
  expressIds: number[];
  /** Their IFC class, as the mesher names it (`IfcWall`, ...). */
  ifcTypes: string[];
  /** `meshNativeElements`' solids buffer (one solid per entry). */
  buffer: Float64Array;
  /** Per entry the representation item its mesh is drawn from (`geometryItemId`, as the IFC path names it), or 0. */
  itemIds: number[];
  /** Their material layer stacks (`meshNativeElements`' layers buffer). */
  layers: Float64Array;
  /** Every `IfcMaterial` a planned layer stack names: the caller colours them. */
  materialIds: number[];
  /** Elements left to the IFC remesh, with why. */
  fallback: Map<number, string>;
}

const CLASS: Record<string, string> = {
  IFCWALL: 'IfcWall', IFCWALLSTANDARDCASE: 'IfcWallStandardCase', IFCSLAB: 'IfcSlab', IFCBEAM: 'IfcBeam', IFCCOLUMN: 'IfcColumn',
  IFCPLATE: 'IfcPlate', IFCROOF: 'IfcRoof', IFCSPACE: 'IfcSpace', IFCMEMBER: 'IfcMember',
  IFCDOOR: 'IfcDoor', IFCWINDOW: 'IfcWindow',
};
/** Built as a slab is: an outline extruded vertically. */
const SLAB_LIKE = new Set(['IFCSLAB', 'IFCPLATE', 'IFCROOF', 'IFCSPACE']);
/** Built as a beam is: a section extruded along an axis. */
const LINEAR = new Set(['IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER']);
/** Built from their one Body extrusion as it stands (a door or window without a joinery type). */
const EXTRUDED = new Set(['IFCDOOR', 'IFCWINDOW']);

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
  /** Element -> its IfcMaterialLayerSetUsage. */
  usageOf: Map<number, number>;
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
  const usageOf = new Map<number, number>();
  for (const relId of reader.ids('IFCRELASSOCIATESMATERIAL')) {
    const rel = reader.entity(relId);
    const usage = refId(rel?.attributes[5]);
    if (usage === null || reader.entity(usage)?.type.toUpperCase() !== 'IFCMATERIALLAYERSETUSAGE') continue;
    for (const ref of Array.isArray(rel?.attributes[4]) ? rel.attributes[4] : []) { const id = refId(ref); if (id !== null) usageOf.set(id, usage); }
  }
  return { store, view, editor: new StoreEditor(store, view), reader, scale: getModelLengthUnitScale(store), openingsOf, interfering, usageOf };
}

/** The element's one Body item, or null (no Body, or several items). */
function bodyItem(ctx: Context, expressId: number): number | null {
  const shape = ctx.reader.entity(refId(ctx.reader.entity(expressId)?.attributes[6]) ?? -1);
  const reps = shape?.attributes[2];
  if (!Array.isArray(reps)) return null;
  for (const ref of reps) {
    const rep = ctx.reader.entity(refId(ref) ?? -1);
    if (rep?.attributes[1] !== 'Body') continue;
    const items = rep.attributes[3];
    return Array.isArray(items) && items.length === 1 ? refId(items[0]) : null;
  }
  return null;
}

/** The element's one Body item, when it is a plain extrusion. */
function plainExtrusion(ctx: Context, expressId: number): number | null {
  const item = bodyItem(ctx, expressId);
  return item !== null && ctx.reader.entity(item)?.type.toUpperCase() === 'IFCEXTRUDEDAREASOLID' ? item : null;
}

/** The world frame of the element's parent placement, as a column-major matrix. */
function parentWorld(ctx: Context, expressId: number): number[] | null {
  const placement = refId(ctx.reader.entity(expressId)?.attributes[5]);
  const parent = placement === null ? null : parentPlacementOf({ dataStore: ctx.store, view: ctx.view }, placement);
  if (parent === null) return translate(0, 0, 0);
  const frame = worldFrame({ dataStore: ctx.store, view: ctx.view }, parent);
  return frame ? matrix(frame.r, frame.t as V3) : null;
}

/**
 * The element's layer stack as the IFC path slices it (`MaterialLayerIndex`):
 * a usage on the element over a set of plain `IfcMaterialLayer`s; null for
 * anything that path keeps whole (no usage, layers with offsets, one layer).
 * Lengths in metres; the frame is the element's placement in the world.
 */
function layerStack(ctx: Context, id: number, elementWorld: number[]): number[] | null {
  const usage = ctx.reader.entity(ctx.usageOf.get(id) ?? -1);
  const set = usage ? ctx.reader.entity(refId(usage.attributes[0]) ?? -1) : null;
  if (!usage || set?.type.toUpperCase() !== 'IFCMATERIALLAYERSET' || !Array.isArray(set.attributes[0])) return null;
  const layers: number[] = [];
  for (const ref of set.attributes[0] as unknown[]) {
    const layer = ctx.reader.entity(refId(ref) ?? -1);
    const thickness = numeric(layer?.attributes[1]);
    if (layer?.type.toUpperCase() !== 'IFCMATERIALLAYER' || thickness === null) return null;
    layers.push(refId(layer.attributes[0]) ?? 0, thickness * ctx.scale);
  }
  if (layers.length < 4) return null;
  const word = (v: unknown) => (typeof v === 'string' ? v.replace(/\./g, '') : '');
  const axis = { AXIS1: 1, AXIS2: 2, AXIS3: 3 }[word(usage.attributes[1])] ?? 2;
  const sense = word(usage.attributes[2]) === 'NEGATIVE' ? -1 : 1;
  const offset = (numeric(usage.attributes[3]) ?? 0) * ctx.scale;
  return [layers.length / 2, axis, sense, offset, ...elementWorld, ...layers];
}

/** The element's own placement frame in its parent's (metres), as a column-major matrix. */
function ownFrame(ctx: Context, expressId: number): number[] | null {
  const placement = refId(ctx.reader.entity(expressId)?.attributes[5]);
  const frame = placement === null ? null : localFrame({ dataStore: ctx.store, view: ctx.view }, placement);
  return frame ? matrix(frame.r, frame.t as V3) : null;
}

/**
 * An opening's cut: a box in its host's frame (metres), or a reason it is
 * not one. A joinery type's opening maps its cut from the type: its boxes,
 * placed as the opening is.
 */
function boxCut(ctx: Context, openingId: number, hostFrame: number[]): NativeSolidSpec[] | string {
  const mapped = bodyItem(ctx, openingId);
  if (mapped !== null && ctx.reader.entity(mapped)?.type.toUpperCase() === 'IFCMAPPEDITEM') {
    const world = parentWorld(ctx, openingId), own = ownFrame(ctx, openingId);
    if (!world || !own) return 'an opening whose placement cannot be read';
    const parts = mappedSolids(ctx.reader, mapped, multiply(world, own), ctx.scale);
    if (typeof parts === 'string') return parts;
    const boxes = parts.every((p) => p.solid.profile.kind === 'polygon' && isAxisRectangle(p.solid.profile.outer));
    return boxes ? parts.map((p) => p.solid) : 'an opening that is not a rectangular cut';
  }
  const item = plainExtrusion(ctx, openingId);
  const solid = item === null ? null : ctx.reader.entity(item);
  const ring = solid ? outline(ctx.reader, refId(solid.attributes[0])) : null;
  if (!ring || typeof ring === 'string' || !isAxisRectangle(ring)) return 'an opening that is not a rectangular cut';
  const placement = readElementPlacement(ctx.store, ctx.editor, openingId);
  const square = (deg: number) => Math.abs(deg / 90 - Math.round(deg / 90)) < 1e-9;
  if (!placement || !square(placement.rx) || !square(placement.ry) || !square(placement.rz)) return 'a turned opening';
  const bounds = placedBodyExtent(ctx.store, openingId, ctx.view);
  if (!bounds) return 'an opening whose cut cannot be read';
  const [min, max] = [bounds.min.map((v) => v * ctx.scale), bounds.max.map((v) => v * ctx.scale)];
  return [{
    profile: { kind: 'polygon', outer: [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]] },
    placement: multiply(hostFrame, translate(0, 0, min[2])),
    depth: max[2] - min[2],
  }];
}

/** The host's cuts, or a reason the native path cannot make them. */
function cutsOf(ctx: Context, hostId: number, hostFrame: number[]): NativeSolidSpec[] | string {
  const cuts: NativeSolidSpec[] = [];
  for (const openingId of ctx.openingsOf.get(hostId) ?? []) {
    if (!ctx.reader.entity(openingId)) continue;
    const cut = boxCut(ctx, openingId, hostFrame);
    if (typeof cut === 'string') return cut;
    cuts.push(...cut);
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

/** A door or window: its one extrusion, or its joinery type's boxes through the mapped item. */
function extrudedParts(ctx: Context, id: number, world: number[]): MappedPart[] | string {
  const item = bodyItem(ctx, id);
  const type = item === null ? '' : ctx.reader.entity(item)?.type.toUpperCase();
  const own = ownFrame(ctx, id);
  if (!own) return 'an element whose placement cannot be read';
  const frame = multiply(world, own);
  if (type === 'IFCMAPPEDITEM') return mappedSolids(ctx.reader, item!, frame, ctx.scale);
  if (type !== 'IFCEXTRUDEDAREASOLID') return 'a body that is not one extrusion or one mapped item';
  const solid = extrusionSolid(ctx.reader, item!, frame, ctx.scale);
  return typeof solid === 'string' ? solid : [{ solid, item: item! }];
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
 * Plan the native remesh of `expressIds`. `eligible(id, layered)` lets the
 * caller veto an element: one drawn differently from how the native path
 * will draw it (`layered`: sliced into one mesh per material layer).
 */
export function planNativeRemesh(
  store: IfcDataStore,
  view: MutablePropertyView,
  expressIds: Iterable<number>,
  eligible: (expressId: number, layered: boolean) => string | null = () => null,
): NativeRemeshPlan {
  const ctx = context(store, view);
  const solids: NativeSolidSpec[] = [];
  const layers: number[] = [];
  const materials = new Set<number>();
  const plan: NativeRemeshPlan = { expressIds: [], ifcTypes: [], buffer: new Float64Array(), itemIds: [], layers: new Float64Array(), materialIds: [], fallback: new Map() };
  for (const id of expressIds) {
    const type = ctx.reader.entity(id)?.type.toUpperCase() ?? '';
    const ifcClass = CLASS[type];
    const world = ifcClass ? parentWorld(ctx, id) : null;
    const own = world ? ownFrame(ctx, id) : null;
    const stack = world && own ? layerStack(ctx, id, multiply(world, own)) : null;
    const veto = !ifcClass ? 'not a class the native path builds' : ctx.interfering.has(id) ? 'cut by or cutting another element' : eligible(id, stack !== null);
    const built = veto ?? (!world ? 'a placement chain that cannot be read'
      : SLAB_LIKE.has(type) ? slabSolid(ctx, id, world)
        : LINEAR.has(type) ? linearSolid(ctx, id, world)
          : EXTRUDED.has(type) ? extrudedParts(ctx, id, world)
            : wallSolid(ctx, id, world));
    if (typeof built === 'string') { plan.fallback.set(id, built); continue; }
    // One solid per part: a mapped body's parts are each their own mesh, as the IFC path draws them.
    const parts = Array.isArray(built) ? built : [{ solid: built, item: plainExtrusion(ctx, id) ?? 0 }];
    for (const part of parts) {
      solids.push(part.solid);
      plan.expressIds.push(id);
      plan.ifcTypes.push(ifcClass);
      plan.itemIds.push(part.item);
      if (stack && parts.length === 1) {
        layers.push(...stack);
        for (let k = 0; k < stack[0]; k++) materials.add(stack[20 + 2 * k]);
      } else {
        layers.push(0);
      }
    }
  }
  plan.buffer = encodeNativeSolids(solids);
  plan.layers = Float64Array.from(layers);
  plan.materialIds = [...materials].filter((m) => m > 0);
  return plan;
}
