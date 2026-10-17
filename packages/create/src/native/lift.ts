/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC (in-memory store, overlay applied) -> native model (N1). Reads back
 * what Lapin's writers describe as parameters: storeys, the catalogue types
 * and their layer materials, walls on an axis, slabs extruded from an
 * outline, beams and columns on a section, and the openings, doors and
 * windows hosted in them (`lift-members.ts`). An element whose IFC form the
 * readers cannot express as parameters is listed in `skipped` with the
 * reason — it is never guessed.
 *
 * Ids: a native id is the UUID its IFC GlobalId encodes (`ifcGuidToUuid`),
 * so lifting the same model twice gives the same ids and re-export keeps the
 * GlobalIds.
 */

import { uuidV5 } from '@ifc-lite/encoding';
import { StoreEditor, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from '../in-store/resolve-anchor.js';
import type { ProfileSection } from '../in-store/profile.js';
import { readRelatedLists } from '../in-store/resolve-relations.js';
import { readCatalogType } from '../in-store/catalog-type.js';
import { readJoineryType } from '../in-store/joinery-read.js';
import { readWallJoinTarget } from '../in-store/wall-join-read.js';
import { resolveSlabEditChain } from '../in-store/edit/slab-edit.js';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';
import {
  NATIVE_SCHEMA_VERSION,
  type NativeElement, type NativeId, type NativeMaterial, type NativeStorey, type NativeType, type PlanPoint,
} from './schema.js';
import { liftBase, nativeIdOf, text, type LiftContext, type LiftResult } from './lift-base.js';
import { ringArea2 } from './validate.js';
import { liftMembers, liftHosted } from './lift-members.js';
import { liftSolids } from './solid.js';
import { forgetParts, liftSystems, liftWallExtras } from './lift-system.js';

/** Material ids derive from their names in this namespace (a material has no GlobalId of its own). */
const MATERIAL_NAMESPACE = '6f1d7c2a-58e4-4c39-9a0b-5b7f0f8a2c11';

/** An entity reference as parsed (a number) or authored (`#id`). */
function refId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  return typeof value === 'string' && /^#[1-9][0-9]*$/.test(value) ? Number(value.slice(1)) : null;
}

function liftStoreys(ctx: LiftContext): NativeStorey[] {
  const storeys: NativeStorey[] = [];
  for (const expressId of ctx.reader.ids('IFCBUILDINGSTOREY')) {
    const entity = ctx.reader.entity(expressId);
    const id = nativeIdOf(entity?.attributes[0]);
    if (!entity || !id) continue;
    const ei = entity.names.indexOf('Elevation');
    const elevation = entity.attributes[ei >= 0 ? ei : 9];
    storeys.push({ id, name: text(entity.attributes[2]) ?? '', elevation: typeof elevation === 'number' ? elevation * ctx.scale : 0 });
  }
  return storeys;
}

/** Element -> storey, from every live IfcRelContainedInSpatialStructure that names a storey. */
function containment(ctx: LiftContext, storeys: Map<number, NativeId>): void {
  for (const relId of ctx.reader.ids('IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const rel = ctx.reader.entity(relId);
    const structure = refId(rel?.attributes[5]);
    const storeyId = structure === null ? undefined : storeys.get(structure);
    if (!rel || !storeyId || !Array.isArray(rel.attributes[4])) continue;
    for (const ref of rel.attributes[4] as unknown[]) {
      const element = refId(ref);
      if (element !== null) ctx.storeyOf.set(element, storeyId);
    }
  }
}

/** Catalogue (wall / slab / beam / column) and joinery types, with their layer materials. */
function liftTypes(ctx: LiftContext, materials: Map<string, NativeMaterial>): NativeType[] {
  const types: NativeType[] = [];
  const material = (name: string, color?: string): NativeId => {
    let m = materials.get(name);
    if (!m) {
      m = { id: uuidV5(MATERIAL_NAMESPACE, name), name, ...(color ? { color } : {}) };
      materials.set(name, m);
    }
    return m.id;
  };
  for (const rel of readRelatedLists(ctx.store, 'IfcRelDefinesByType', ctx.view)) {
    if (rel.relatingId === undefined) continue;
    const typeEntity = ctx.reader.entity(rel.relatingId);
    const typeId = nativeIdOf(typeEntity?.attributes[0]);
    if (!typeEntity || !typeId) continue;
    let type: NativeType | null = null;
    const joinery = readJoineryType(ctx.store, rel.relatingId, ctx.view);
    if (joinery) {
      type = { id: typeId, kind: joinery.spec.kind, name: joinery.spec.name, spec: joinery.spec };
    } else {
      const spec = readCatalogType(ctx.store, rel.relatingId, ctx.view)?.spec as
        { kind?: string; name?: string; mark?: string; height?: number; layers?: { name: string; thickness: number; color?: string }[]; section?: ProfileSection } | undefined;
      const name = spec?.name ?? text(typeEntity.attributes[2]) ?? '';
      const mark = spec?.mark ? { mark: spec.mark } : {};
      const layers = () => (spec?.layers ?? []).map((l) => ({ materialId: material(l.name, l.color), thickness: l.thickness }));
      if (spec?.kind === 'wall') type = { id: typeId, kind: 'wall', name, ...mark, layers: layers(), ...(spec.height ? { height: spec.height } : {}) };
      else if (spec?.kind === 'slab') type = { id: typeId, kind: 'slab', name, ...mark, layers: layers() };
      else if ((spec?.kind === 'beam' || spec?.kind === 'column') && spec.section) {
        type = spec.kind === 'beam'
          ? { id: typeId, kind: 'beam', name, ...mark, section: spec.section }
          : { id: typeId, kind: 'column', name, ...mark, section: spec.section, ...(spec.height ? { height: spec.height } : {}) };
      }
    }
    if (!type) continue;
    types.push(type);
    for (const related of rel.relatedIds) ctx.typeOf.set(related, typeId);
  }
  return types;
}

export function liftWall(ctx: LiftContext, expressId: number): NativeElement | null {
  const base = liftBase(ctx, expressId, 'wall');
  if (!base) return null;
  const read = readWallJoinTarget(ctx.store, ctx.view, expressId, ctx.scale);
  const storeyPlacement = ctx.reader.storeyPlacementId(contained(ctx, expressId));
  const skip = (reason: string) => { ctx.skipped.push({ expressId, ifcType: 'IfcWall', reason }); return null; };
  if (!read || !Number.isFinite(read.height)) return skip('the body is not an extruded straight wall');
  if (read.parentPlacementId !== storeyPlacement) return skip('not placed on its storey');
  const w = read.wall;
  const baseOffset = Math.round(read.location[2] * ctx.scale * 1e9) / 1e9;
  return liftWallExtras(ctx, expressId, {
    ...base, kind: 'wall', start: w.start, end: w.end, thickness: w.thickness, height: read.height,
    ...(baseOffset !== 0 ? { baseOffset } : {}),
    ...(w.offset ? { offset: w.offset } : {}),
    ...(w.startCut ? { startCut: w.startCut } : {}),
    ...(w.endCut ? { endCut: w.endCut } : {}),
  });
}

export function liftSlab(ctx: LiftContext, expressId: number): NativeElement | null {
  const base = liftBase(ctx, expressId, 'slab');
  if (!base) return null;
  const chain = resolveSlabEditChain(ctx.store, ctx.view, ctx.editor, expressId, ctx.scale);
  if (!chain || chain.baseElevation === null) {
    ctx.skipped.push({ expressId, ifcType: 'IfcSlab', reason: 'the body is not a vertical extrusion of a plan outline' });
    return null;
  }
  let outline: PlanPoint[] = chain.footprint.map((p) => [p[0], p[1]]);
  if (ringArea2(outline) < 0) outline = outline.reverse();
  const top = chain.extrusionUp ? chain.baseElevation + chain.thickness : chain.baseElevation;
  const topOffset = Math.round(top * 1e9) / 1e9;
  return { ...base, kind: 'slab', outline, thickness: chain.thickness, ...(topOffset !== 0 ? { topOffset } : {}) };
}

/** The storey an element is contained in, as the storey's express id (for its placement), or -1. */
function contained(ctx: LiftContext, expressId: number): number {
  const storeyId = ctx.storeyOf.get(expressId);
  return storeyId ? ctx.storeyExpressOf.get(storeyId) ?? -1 : -1;
}

/** Lift a model's store (with its overlay) into the native schema. */
export function liftNativeModel(
  store: IfcDataStore, view: MutablePropertyView, meta: { id: NativeId; name: string },
  /** `geometrySolids: false` (an export): plain extrusions without a Studio history are not read as solids. */
  options: { geometrySolids?: boolean } = {},
): LiftResult {
  const ctx: LiftContext = {
    store, view, editor: new StoreEditor(store, view), reader: new AnchorEntityReader(store, view),
    scale: getModelLengthUnitScale(store), storeyOf: new Map(), storeyExpressOf: new Map(), typeOf: new Map(), lifted: new Map(), skipped: [], partOf: new Map(),
    ...(options.geometrySolids === false ? { geometrySolids: false } : {}),
  };
  const storeys = liftStoreys(ctx);
  const storeyExpress = new Map<number, NativeId>();
  for (const expressId of ctx.reader.ids('IFCBUILDINGSTOREY')) {
    const id = nativeIdOf(ctx.reader.entity(expressId)?.attributes[0]);
    if (id) { storeyExpress.set(expressId, id); ctx.storeyExpressOf.set(id, expressId); }
  }
  containment(ctx, storeyExpress);
  const materials = new Map<string, NativeMaterial>();
  const types = liftTypes(ctx, materials);
  const add = (expressId: number, element: NativeElement | null) => { if (element) ctx.lifted.set(expressId, element); };
  for (const id of ctx.reader.ids('IFCWALL')) add(id, liftWall(ctx, id));
  for (const id of ctx.reader.ids('IFCWALLSTANDARDCASE')) add(id, liftWall(ctx, id));
  for (const id of ctx.reader.ids('IFCSLAB')) add(id, liftSlab(ctx, id));
  liftMembers(ctx);
  liftHosted(ctx);
  liftSystems(ctx);
  liftSolids(ctx);
  forgetParts(ctx);
  const expressIds = new Map<NativeId, number>();
  for (const [expressId, element] of ctx.lifted) expressIds.set(element.id, expressId);
  return {
    model: {
      schemaVersion: NATIVE_SCHEMA_VERSION, id: meta.id, name: meta.name, storeys,
      elements: [...ctx.lifted.values()], types, materials: [...materials.values()], relations: [], properties: [],
    },
    expressIds,
    skipped: ctx.skipped,
    parts: ctx.partOf,
  };
}
