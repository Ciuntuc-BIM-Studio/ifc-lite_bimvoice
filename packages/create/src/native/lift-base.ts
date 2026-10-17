/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** What every native lifter shares (split from `lift.ts` so the per-class lifters do not import it back). */

import { ifcGuidToUuid, isValidIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { AnchorEntityReader } from '../in-store/resolve-anchor.js';
import { ownSolidOf } from '../in-store/body-trim.js';
import type { NativeElement, NativeElementBase, NativeId, NativeKind, NativeModel } from './schema.js';

export interface LiftSkip {
  expressId: number;
  ifcType: string;
  reason: string;
}

export interface LiftResult {
  model: NativeModel;
  /** Native id -> express id, for every lifted element. */
  expressIds: Map<NativeId, number>;
  skipped: LiftSkip[];
  /** Elements built from a system's (or a wall's) spec, by express id: the system they belong to. */
  parts: Map<number, NativeId>;
}

/** What the per-class lifters share. */
export interface LiftContext {
  store: IfcDataStore;
  view: MutablePropertyView;
  editor: StoreEditor;
  reader: AnchorEntityReader;
  /** Native unit -> metres. */
  scale: number;
  /** Element express id -> its storey's native id. */
  storeyOf: Map<number, NativeId>;
  /** Storey native id -> its express id. */
  storeyExpressOf: Map<NativeId, number>;
  /** Element express id -> its type's native id (only lifted catalogue / joinery types). */
  typeOf: Map<number, NativeId>;
  /** Lifted elements by express id (hosts for openings). */
  lifted: Map<number, NativeElement>;
  skipped: LiftSkip[];
  /** Parts of a system or a timber-framed wall, by express id: the native id of what they belong to. */
  partOf: Map<number, NativeId>;
  /** Lift plain extrusions without a Studio history as solids too (default); off, only recorded solids are read. */
  geometrySolids?: boolean;
}

/** The native id of an IFC GlobalId, or null when it is not a valid one. */
export function nativeIdOf(globalId: unknown): NativeId | null {
  return typeof globalId === 'string' && isValidIfcGuid(globalId) ? ifcGuidToUuid(globalId) : null;
}

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** How the element's Body item was combined in Studio (`body-trim.ts`), or null. */
function bodyCombination(reader: AnchorEntityReader, shapeRef: unknown): 'union' | 'intersection' | null {
  const shape = reader.entity(refId(shapeRef) ?? -1);
  const reps = Array.isArray(shape?.attributes[2]) ? (shape!.attributes[2] as unknown[]) : [];
  for (const rep of reps) {
    const r = reader.entity(refId(rep) ?? -1);
    if (r?.attributes[1] !== 'Body' || !Array.isArray(r.attributes[3])) continue;
    const item = refId(r.attributes[3][0]);
    return item === null ? null : ownSolidOf((id) => reader.entity(id), item).combined;
  }
  return null;
}

export const text = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const enumValue = (v: unknown): string | undefined => (typeof v === 'string' ? v.replace(/^\.|\.$/g, '') || undefined : undefined);

/** The IfcRoot / IfcElement fields every class shares, or null (with a skip) when the GlobalId is unusable. */
export function liftBase(ctx: LiftContext, expressId: number, kind: NativeKind): NativeElementBase | null {
  const entity = ctx.reader.entity(expressId);
  if (!entity) return null;
  const at = (name: string, fallback: number) => {
    const i = entity.names.indexOf(name);
    return entity.attributes[i >= 0 ? i : fallback];
  };
  const id = nativeIdOf(at('GlobalId', 0));
  const storeyId = ctx.storeyOf.get(expressId);
  const skip = (reason: string) => { ctx.skipped.push({ expressId, ifcType: entity.type, reason }); return null; };
  if (!id) return skip('no valid GlobalId');
  if (!storeyId) return skip('not contained in a storey');
  const predefined = enumValue(at('PredefinedType', 8));
  const base: NativeElementBase = { id, kind, storeyId };
  const name = text(at('Name', 2)), description = text(at('Description', 3)), objectType = text(at('ObjectType', 4)), tag = text(at('Tag', 7));
  if (predefined && predefined !== 'NOTDEFINED') base.predefinedType = predefined;
  if (name !== undefined) base.name = name;
  if (description !== undefined) base.description = description;
  if (objectType !== undefined) base.objectType = objectType;
  if (tag !== undefined) base.tag = tag;
  const typeId = ctx.typeOf.get(expressId);
  if (typeId) base.typeId = typeId;
  const combined = bodyCombination(ctx.reader, at('Representation', 6));
  if (combined) base.combined = combined;
  return base;
}

