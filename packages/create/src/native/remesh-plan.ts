/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Which edited elements the native mesher can rebuild exactly, and the
 * solids to send it (N3, `meshNativeElements`). Only what the native path
 * reproduces exactly is planned; everything else is left to the IFC remesh
 * with the reason:
 *
 *  - walls, slabs, beams, columns and the classes after them whose body the
 *    native mesher builds (extrusions, faceted shells, swept disks, mapped
 *    joinery, roof trims), with what cut priorities subtract from them
 *    (`IfcRelInterferesElements`, the cutter's own body);
 *  - their openings are axis-aligned boxes in the host's frame (an arched or
 *    turned cut is left to the IFC path, which cuts it exactly).
 *
 * Solids are placed in the model's IFC frame, metres: the element's own
 * parameters (lifted as for the native model) under its parent placement's
 * world frame (`worldFrame`).
 */

import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { readWallJoinTarget } from '../in-store/wall-join-read.js';
import { resolveSlabEditChain } from '../in-store/edit/slab-edit.js';
import { resolveLinearElementChain } from '../in-store/edit/linear-element-edit.js';
import { readElementPlacement } from '../in-store/element-relocate.js';
import { placedBodyExtent } from '../in-store/resolve-host.js';
import { brepSolid, roofTrimCuts } from './remesh-faces.js';
import { isAxisRectangle, itemParts, mappedSolids, multiply, numeric, outline, type MappedPart } from './remesh-extrusion.js';
import {
  bodyItem, bodyItems, context, layerStack, matrix, ownFrame, parentWorld, plainExtrusion, planTurn, refId, translate, type Context,
} from './remesh-context.js';
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
  /** Per entry its element's frame (column-major, metres; NaN when unknown or voided, as the IFC path): the meshes' `localToWorld`. */
  frames: Float64Array;
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
  IFCDOOR: 'IfcDoor', IFCWINDOW: 'IfcWindow', IFCSTAIRFLIGHT: 'IfcStairFlight', IFCRAILING: 'IfcRailing',
  IFCBUILDINGELEMENTPROXY: 'IfcBuildingElementProxy', IFCCOVERING: 'IfcCovering', IFCFURNISHINGELEMENT: 'IfcFurnishingElement',
  IFCFOOTING: 'IfcFooting', IFCRAMPFLIGHT: 'IfcRampFlight', IFCCHIMNEY: 'IfcChimney', IFCSHADINGDEVICE: 'IfcShadingDevice',
};
/** Built as a slab is: an outline extruded vertically. */
const SLAB_LIKE = new Set(['IFCSLAB', 'IFCPLATE', 'IFCROOF', 'IFCSPACE']);
/** Built as a beam is: a section extruded along an axis. */
const LINEAR = new Set(['IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER']);
/** Built from their body items as they stand (`extrudedParts`). */
const EXTRUDED = new Set(['IFCDOOR', 'IFCWINDOW', 'IFCSTAIRFLIGHT', 'IFCRAILING', 'IFCBUILDINGELEMENTPROXY', 'IFCCOVERING',
  'IFCFURNISHINGELEMENT', 'IFCFOOTING', 'IFCRAMPFLIGHT', 'IFCCHIMNEY', 'IFCSHADINGDEVICE']);

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
  const own = ownFrame(ctx, id);
  if (!own) return 'a wall whose placement cannot be read';
  const frame = multiply(world, own);
  // A wall attached to a roof: its extrusion inside the trim, the trim's prisms cut from it.
  let trim: NativeSolidSpec[] = [];
  if (plainExtrusion(ctx, id) !== read.solidId) {
    const item = bodyItem(ctx, id);
    const trimmed = item === null ? null : roofTrimCuts(ctx.reader, item, frame, ctx.scale);
    if (!trimmed || typeof trimmed === 'string' || trimmed.inner !== read.solidId) return typeof trimmed === 'string' ? trimmed : 'a trimmed or clipped wall body';
    trim = trimmed.cuts;
  }
  const w = read.wall;
  const outline = wallBodyOutline(w);
  // The axis starts `a0` along the placement's X (the start the lift reads, minus its origin).
  const a0 = Math.hypot(w.start[0] - read.origin[0], w.start[1] - read.origin[1])
    * Math.sign((w.start[0] - read.origin[0]) * (w.end[0] - w.start[0]) + (w.start[1] - read.origin[1]) * (w.end[1] - w.start[1]) || 1);
  const openings = cutsOf(ctx, id, frame);
  if (typeof openings === 'string') return openings;
  const cuts = [...openings, ...trim];
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

function isFaceted(ctx: Context, id: number): boolean {
  const item = bodyItem(ctx, id);
  return item !== null && ctx.reader.entity(item)?.type.toUpperCase() === 'IFCFACETEDBREP';
}

/** A faceted element (a rafter with cut ends, a sloped roof plane): its polyhedron, with its openings cut. */
function facetedSolid(ctx: Context, id: number, world: number[]): NativeSolidSpec | string {
  const own = ownFrame(ctx, id);
  if (!own) return 'an element whose placement cannot be read';
  const frame = multiply(world, own);
  const solid = brepSolid(ctx.reader, bodyItem(ctx, id)!, frame, ctx.scale);
  if (typeof solid === 'string') return solid;
  const cuts = cutsOf(ctx, id, frame);
  if (typeof cuts === 'string') return cuts;
  return cuts.length ? { ...solid, cuts } : solid;
}

/**
 * An element built from its body items as they stand: a door or window (its
 * extrusion, or its joinery type's boxes through the mapped item), a stair
 * flight, a railing (handrail and posts): one part per item.
 */
function extrudedParts(ctx: Context, id: number, world: number[]): MappedPart[] | string {
  const items = bodyItems(ctx, id);
  if (items.length === 0) return 'an element without a body';
  const own = ownFrame(ctx, id);
  if (!own) return 'an element whose placement cannot be read';
  return itemParts(ctx.reader, items, multiply(world, own), ctx.scale);
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

/** An element's parts, built by its kind; or a reason the native path cannot. */
function elementParts(ctx: Context, id: number, type: string, world: number[]): MappedPart[] | string {
  const built = isFaceted(ctx, id) ? facetedSolid(ctx, id, world)
    : SLAB_LIKE.has(type) ? slabSolid(ctx, id, world)
      : LINEAR.has(type) ? linearSolid(ctx, id, world)
        : EXTRUDED.has(type) ? extrudedParts(ctx, id, world)
          : wallSolid(ctx, id, world);
  return typeof built === 'string' || Array.isArray(built) ? built : [{ solid: built, item: bodyItem(ctx, id) ?? 0 }];
}

/**
 * `parts` with what a cut priority subtracts from the element (its
 * IfcRelInterferesElements cutters, `Context.cutters`): each cutter's body as
 * the native path builds it, its own cuts left off (the IFC pre-pass cuts
 * with the cutter's body, like an opening's); a reason when a cutter cannot
 * be built.
 */
function withCutters(ctx: Context, id: number, parts: MappedPart[] | string): MappedPart[] | string {
  if (typeof parts === 'string') return parts;
  const cutters = (ctx.cutters.get(id) ?? []).filter((c) => ctx.reader.entity(c));
  if (cutters.length === 0) return parts;
  const extra: NativeSolidSpec[] = [];
  for (const cutter of cutters) {
    const type = ctx.reader.entity(cutter)?.type.toUpperCase() ?? '';
    const world = CLASS[type] ? parentWorld(ctx, cutter) : null;
    const body = world ? elementParts(ctx, cutter, type, world) : null;
    if (!body || typeof body === 'string') return `cut by #${cutter}, which the native path cannot build${typeof body === 'string' ? ` (${body})` : ''}`;
    for (const part of body) extra.push({ ...part.solid, cuts: undefined });
  }
  return parts.map((part) => ({ ...part, solid: { ...part.solid, cuts: [...(part.solid.cuts ?? []), ...extra] } }));
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
  const frames: number[] = [];
  const plan: NativeRemeshPlan = { expressIds: [], ifcTypes: [], buffer: new Float64Array(), itemIds: [], frames: new Float64Array(), layers: new Float64Array(), materialIds: [], fallback: new Map() };
  for (const id of expressIds) {
    const type = ctx.reader.entity(id)?.type.toUpperCase() ?? '';
    const ifcClass = CLASS[type];
    const world = ifcClass ? parentWorld(ctx, id) : null;
    const own = world ? ownFrame(ctx, id) : null;
    const stack = world && own ? layerStack(ctx, id, multiply(world, own)) : null;
    const veto = !ifcClass ? 'not a class the native path builds' : eligible(id, stack !== null);
    const built = veto ?? (!world ? 'a placement chain that cannot be read' : withCutters(ctx, id, elementParts(ctx, id, type, world)));
    if (typeof built === 'string') { plan.fallback.set(id, built); continue; }
    // One solid per part: a mapped body's parts are each their own mesh, as the IFC path draws them.
    const parts = built;
    for (const part of parts) {
      solids.push(part.solid);
      plan.expressIds.push(id);
      plan.ifcTypes.push(ifcClass);
      plan.itemIds.push(part.item);
      // As the IFC path: an element its openings void (or a cut priority cuts) comes out of the void cut without its frame.
      const voided = (ctx.openingsOf.get(id) ?? []).some((o) => ctx.reader.entity(o)) || (ctx.cutters.get(id) ?? []).some((c) => ctx.reader.entity(c));
      frames.push(...(world && own && !voided ? multiply(world, own) : new Array<number>(16).fill(Number.NaN)));
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
  plan.frames = Float64Array.from(frames);
  plan.materialIds = [...materials].filter((m) => m > 0);
  return plan;
}
