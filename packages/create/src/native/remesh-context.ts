/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the native remesh plan reads an element through (`remesh-plan.ts`):
 * the model's relationships indexed once (openings, cuts, layer usages),
 * an element's Body items, its placement frames, its layer stack.
 */

import { StoreEditor, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from '../in-store/resolve-anchor.js';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';
import { localFrame, worldFrame } from '../in-store/placement-3d.js';
import { parentPlacementOf } from '../in-store/element-transform-frames.js';
import { numeric } from './remesh-extrusion.js';

export type V3 = [number, number, number];
type Ref = (value: unknown) => number | null;

export const refId: Ref = (value) => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return typeof value === 'string' && /^#[1-9][0-9]*$/.test(value) ? Number(value.slice(1)) : null;
};

/** Column-major matrix of a frame (rotation rows `r`, translation `t`). */
export function matrix(r: number[][], t: V3): number[] {
  return [r[0][0], r[1][0], r[2][0], 0, r[0][1], r[1][1], r[2][1], 0, r[0][2], r[1][2], r[2][2], 0, t[0], t[1], t[2], 1];
}

export const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
export const planTurn = (x: number, y: number, z: number, angle: number) =>
  [Math.cos(angle), Math.sin(angle), 0, 0, -Math.sin(angle), Math.cos(angle), 0, 0, 0, 0, 1, 0, x, y, z, 1];

export interface Context {
  store: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
  reader: AnchorEntityReader;
  scale: number;
  /** Host express id -> the openings voiding it. */
  openingsOf: Map<number, number[]>;
  /**
   * Element -> the elements cut from it (IfcRelInterferesElements with
   * ImpliedOrder TRUE: the RelatedElement is subtracted from the
   * RelatingElement, as the IFC pre-pass reads it; FALSE / UNKNOWN cut nothing).
   */
  cutters: Map<number, number[]>;
  /** Element -> its IfcMaterialLayerSetUsage. */
  usageOf: Map<number, number>;
}

export function context(store: IfcDataStore, view: MutablePropertyView): Context {
  const reader = new AnchorEntityReader(store, view);
  const openingsOf = new Map<number, number[]>();
  for (const relId of reader.ids('IFCRELVOIDSELEMENT')) {
    const rel = reader.entity(relId);
    const host = refId(rel?.attributes[4]), opening = refId(rel?.attributes[5]);
    if (host === null || opening === null) continue;
    openingsOf.set(host, [...(openingsOf.get(host) ?? []), opening]);
  }
  const cutters = new Map<number, number[]>();
  for (const relId of reader.ids('IFCRELINTERFERESELEMENTS')) {
    const rel = reader.entity(relId);
    const implied = rel?.attributes[rel.attributes.length - 1];
    if (!(implied === true || (typeof implied === 'string' && implied.replace(/\./g, '').toUpperCase() === 'T'))) continue;
    const cut = refId(rel?.attributes[4]), cutter = refId(rel?.attributes[5]);
    if (cut !== null && cutter !== null && cut !== cutter) cutters.set(cut, [...(cutters.get(cut) ?? []), cutter]);
  }
  const usageOf = new Map<number, number>();
  for (const relId of reader.ids('IFCRELASSOCIATESMATERIAL')) {
    const rel = reader.entity(relId);
    const usage = refId(rel?.attributes[5]);
    if (usage === null || reader.entity(usage)?.type.toUpperCase() !== 'IFCMATERIALLAYERSETUSAGE') continue;
    for (const ref of Array.isArray(rel?.attributes[4]) ? rel.attributes[4] : []) { const id = refId(ref); if (id !== null) usageOf.set(id, usage); }
  }
  return { store, view, editor: new StoreEditor(store, view), reader, scale: getModelLengthUnitScale(store), openingsOf, cutters, usageOf };
}

/** The element's Body items (empty without a Body). */
export function bodyItems(ctx: Context, expressId: number): number[] {
  const shape = ctx.reader.entity(refId(ctx.reader.entity(expressId)?.attributes[6]) ?? -1);
  const reps = shape?.attributes[2];
  if (!Array.isArray(reps)) return [];
  for (const ref of reps) {
    const rep = ctx.reader.entity(refId(ref) ?? -1);
    if (rep?.attributes[1] !== 'Body') continue;
    const items = Array.isArray(rep.attributes[3]) ? rep.attributes[3].map(refId) : [];
    return items.every((id) => id !== null) ? items as number[] : [];
  }
  return [];
}

/** The element's one Body item, or null (no Body, or several items). */
export function bodyItem(ctx: Context, expressId: number): number | null {
  const items = bodyItems(ctx, expressId);
  return items.length === 1 ? items[0] : null;
}

/** The element's one Body item, when it is a plain extrusion. */
export function plainExtrusion(ctx: Context, expressId: number): number | null {
  const item = bodyItem(ctx, expressId);
  return item !== null && ctx.reader.entity(item)?.type.toUpperCase() === 'IFCEXTRUDEDAREASOLID' ? item : null;
}

/** The world frame of the element's parent placement, as a column-major matrix. */
export function parentWorld(ctx: Context, expressId: number): number[] | null {
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
export function layerStack(ctx: Context, id: number, elementWorld: number[]): number[] | null {
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
export function ownFrame(ctx: Context, expressId: number): number[] | null {
  const placement = refId(ctx.reader.entity(expressId)?.attributes[5]);
  const frame = placement === null ? null : localFrame({ dataStore: ctx.store, view: ctx.view }, placement);
  return frame ? matrix(frame.r, frame.t as V3) : null;
}

