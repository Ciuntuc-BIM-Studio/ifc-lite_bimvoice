/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A roof system in a model: an IfcRoof (no body of its own) aggregating
 * (IfcRelAggregates) one IfcSlab ROOF per plane — the covering, its
 * thickness across the slope — and the structure as IfcMember RAFTER /
 * PURLIN / PLATE and the ridge beam. Its spec (outline, per-edge rules,
 * covering, structure) is stored on the roof as Pset_IfcLiteRoofSystem, so
 * the block regenerates from the model alone.
 *
 * `regenerateRoofSystemInStore` rebuilds the parts from a changed spec in
 * place: a part whose key (role, plane / line, order — its Tag) is still
 * generated keeps its entity and GlobalId and gets new geometry; new keys
 * become new parts; parts no longer generated are removed. Coordinates:
 * storey-local metres; the outline is the wall-plate line, `eaveHeight`
 * above the storey.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { emitLocalPlacement, emitSurfaceStyle, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { addFacetedElementToStore, replaceFacetedGeometryInStore } from './faceted.js';
import { addMemberToStore } from './member.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { roofSolidFaces } from './roof-surface.js';
import { roofGeometry, type RoofEdgeRule, type RoofGeometry } from './roof-system.js';
import { roofStructure, type RoofMember, type RoofStructureSpec } from './roof-structure.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Attr = Parameters<StoreEditor['addEntity']>[1];

export const ROOF_SYSTEM_PSET = 'Pset_IfcLiteRoofSystem';

export interface RoofSystemSpec {
  /** The drafting contour (or project item) the system was made from. */
  id?: string;
  name: string;
  /** Wall-plate line, storey-local metres. */
  outline: Vec2[];
  rules: RoofEdgeRule[];
  /** Wall plate above the storey, metres. */
  eaveHeight: number;
  covering: { thickness: number; color: string };
  structure: RoofStructureSpec;
  timberColor: string;
}

export interface RoofSystemResult {
  roofId: number;
  globalId: string;
  /** Parts written or rewritten (to re-mesh), and parts removed. */
  parts: number[];
  removed: number[];
}

function roofShape(g: RoofGeometry): string {
  const eaves = g.rules.filter((r) => r.kind === 'eave').length;
  if (eaves === 1) return 'SHED_ROOF';
  if (eaves === g.rules.length) return g.outline.length === 4 ? 'HIP_ROOF' : 'FREEFORM';
  return g.outline.length === 4 && eaves === 2 ? 'GABLE_ROOF' : 'FREEFORM';
}

const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : { red: 0.6, green: 0.4, blue: 0.3 };
};

/** Colour every item of a product we just wrote. */
function stylePart(editor: StoreEditor, productShapeId: number, styleRef: number): void {
  const view = editor.getMutationView();
  const ref = (v: unknown) => (typeof v === 'string' && v.startsWith('#') ? Number(v.slice(1)) : null);
  for (const rep of (view.getNewEntity(productShapeId)?.attributes[2] as unknown[] | undefined) ?? []) {
    const repId = ref(rep);
    for (const item of (repId === null ? [] : (view.getNewEntity(repId)?.attributes[3] as unknown[] | undefined)) ?? []) {
      editor.addEntity('IfcStyledItem', [item as string, [`#${styleRef}`], null]);
    }
  }
}

interface PartPlan {
  key: string;
  build: (globalId: string | undefined) => { id: number; shape: number };
  /** New geometry for an existing part: placement and representation written onto it. */
  rewrite: (id: number) => number;
}

function partPlans(editor: StoreEditor, anchor: SpatialAnchor, spec: RoofSystemSpec, g: RoofGeometry, members: RoofMember[]): PartPlan[] {
  const lift = spec.eaveHeight;
  const plans: PartPlan[] = [];
  g.planes.forEach((plane) => {
    const tv = spec.covering.thickness / Math.cos((plane.pitch * Math.PI) / 180);
    const bottom = plane.pts.map(([x, y, z]) => [x, y, z - tv] as Vec3);
    const params = {
      IfcClass: 'IfcSlab', PredefinedType: 'ROOF', Name: `${spec.name} plane ${plane.edge + 1}`, Tag: `plane:${plane.edge}`,
      Faces: roofSolidFaces([bottom], tv), Location: [0, 0, lift] as Vec3,
    };
    plans.push({
      key: params.Tag,
      build: (GlobalId) => {
        const made = addFacetedElementToStore(editor, anchor, { ...params, GlobalId });
        editor.removeEntity(made.relContainedId);
        return { id: made.elementId, shape: made.productShapeId };
      },
      rewrite: (id) => replaceFacetedGeometryInStore(editor, anchor, id, params).productShapeId,
    });
  });
  const kinds: Record<RoofMember['role'], { type: 'RAFTER' | 'PURLIN' | 'PLATE' | 'MEMBER'; name: string }> = {
    rafter: { type: 'RAFTER', name: 'Rafter' }, hip: { type: 'RAFTER', name: 'Hip rafter' }, valley: { type: 'RAFTER', name: 'Valley rafter' },
    ridge: { type: 'MEMBER', name: 'Ridge beam' }, purlin: { type: 'PURLIN', name: 'Purlin' }, plate: { type: 'PLATE', name: 'Wall plate' },
  };
  for (const m of members) {
    const params = {
      Start: [m.start[0], m.start[1], m.start[2] + lift] as Vec3, End: [m.end[0], m.end[1], m.end[2] + lift] as Vec3,
      Width: m.width, Height: m.depth, PredefinedType: kinds[m.role].type, Name: `${kinds[m.role].name}`, Tag: m.key,
    };
    const build = (GlobalId?: string) => {
      const made = addMemberToStore(editor, anchor, { ...params, GlobalId });
      editor.removeEntity(made.relContainedId);
      return { id: made.memberId, shape: made.productShapeId };
    };
    plans.push({
      key: m.key,
      build,
      rewrite: (id) => {
        // Build the new geometry on a scratch member, move it over, drop the scratch.
        const scratch = build();
        const attrs = editor.getMutationView().getNewEntity(scratch.id)!.attributes;
        editor.setPositionalAttribute(id, 5, attrs[5] as Attr[number]);
        editor.setPositionalAttribute(id, 6, attrs[6] as Attr[number]);
        editor.removeEntity(scratch.id);
        return scratch.shape;
      },
    });
  }
  return plans;
}

function specProperty(editor: StoreEditor, spec: RoofSystemSpec): number {
  return editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(spec) } }, null]).expressId;
}

export function addRoofSystemToStore(editor: StoreEditor, anchor: SpatialAnchor, spec: RoofSystemSpec, params: { GlobalId?: string } = {}): RoofSystemResult {
  const g = roofGeometry(spec.outline, spec.rules);
  const members = roofStructure(g, spec.structure);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, [0, 0, 0]);
  const globalId = productGuid(params, anchor.guidRandom);
  const roofId = editor.addEntity('IfcRoof', [
    globalId, ownerHistoryRef(anchor.ownerHistoryId), spec.name, null, null, `#${placementId}`, null, null, `.${roofShape(g)}.`,
  ] as Attr).expressId;
  editor.addEntity('IfcRelContainedInSpatialStructure', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${roofId}`], `#${anchor.storeyId}`]);
  const schema = anchor.schema ?? 'IFC4';
  const cover = emitSurfaceStyle(editor, schema, rgb(spec.covering.color), `${spec.name} covering`).styleRefId;
  const timber = emitSurfaceStyle(editor, schema, rgb(spec.timberColor), `${spec.name} timber`).styleRefId;
  const parts = partPlans(editor, anchor, spec, g, members).map((plan) => {
    const made = plan.build(undefined);
    stylePart(editor, made.shape, plan.key.startsWith('plane:') ? cover : timber);
    return made.id;
  });
  if (parts.length) editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${roofId}`, parts.map((id) => `#${id}`)]);
  const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), ROOF_SYSTEM_PSET, null, [`#${specProperty(editor, spec)}`]]).expressId;
  editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${roofId}`], `#${pset}`]);
  return { roofId, globalId, parts, removed: [] };
}

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

interface RoofRead {
  spec: RoofSystemSpec;
  /** The Spec property, to rewrite. */
  propertyId: number;
  aggregateId: number | null;
  parts: { id: number; tag: string }[];
}

function readRoof(store: IfcDataStore, roofId: number, view?: MutablePropertyView | null): RoofRead | null {
  const reader = new AnchorEntityReader(store, view);
  let found: { spec: RoofSystemSpec; propertyId: number } | null = null;
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === roofId)) continue;
    const set = reader.entity(refId(rel.attributes[5]) ?? -1);
    if (!set || set.attributes[2] !== ROOF_SYSTEM_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      const v = prop.attributes[2] as unknown;
      const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
      try { found = { spec: JSON.parse(String(raw)) as RoofSystemSpec, propertyId: refId(p)! }; } catch { found = null; }
    }
  }
  if (!found) return null;
  let aggregateId: number | null = null;
  const parts: { id: number; tag: string }[] = [];
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== roofId) continue;
    aggregateId = relId;
    for (const r of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const id = refId(r);
      const part = id === null ? null : reader.entity(id);
      if (part && id !== null) parts.push({ id, tag: typeof part.attributes[7] === 'string' ? part.attributes[7] : '' });
    }
  }
  return { ...found, aggregateId, parts };
}

/** The spec stored on a roof system, or null when `roofId` is not one. */
export function readRoofSystem(store: IfcDataStore, roofId: number, view?: MutablePropertyView | null): RoofSystemSpec | null {
  return readRoof(store, roofId, view)?.spec ?? null;
}

/** The roof system an element belongs to (the roof itself, or one of its parts), or null. */
export function roofSystemOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  if (readRoof(store, elementId, view)) return elementId;
  const reader = new AnchorEntityReader(store, view);
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    const parts = rel?.attributes[5];
    if (!Array.isArray(parts) || !parts.some((r) => refId(r) === elementId)) continue;
    const roof = refId(rel!.attributes[4]);
    if (roof !== null && readRoof(store, roof, view)) return roof;
  }
  return null;
}

export function regenerateRoofSystemInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, roofId: number, spec: RoofSystemSpec): RoofSystemResult {
  const view = editor.getMutationView();
  const current = readRoof(store, roofId, view);
  if (!current) throw new Error(`#${roofId} is not a roof system`);
  const g = roofGeometry(spec.outline, spec.rules);
  const members = roofStructure(g, spec.structure);
  const schema = anchor.schema ?? 'IFC4';
  const cover = emitSurfaceStyle(editor, schema, rgb(spec.covering.color), `${spec.name} covering`).styleRefId;
  const timber = emitSurfaceStyle(editor, schema, rgb(spec.timberColor), `${spec.name} timber`).styleRefId;
  const existing = new Map(current.parts.map((p) => [p.tag, p.id]));
  const parts: number[] = [];
  for (const plan of partPlans(editor, anchor, spec, g, members)) {
    const id = existing.get(plan.key);
    const style = plan.key.startsWith('plane:') ? cover : timber;
    if (id !== undefined) {
      existing.delete(plan.key);
      stylePart(editor, plan.rewrite(id), style);
      parts.push(id);
    } else {
      const made = plan.build(undefined);
      stylePart(editor, made.shape, style);
      parts.push(made.id);
    }
  }
  const removed = [...existing.values()];
  for (const id of removed) editor.removeEntity(id);
  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, parts.map((id) => `#${id}`));
  else if (parts.length) editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${roofId}`, parts.map((id) => `#${id}`)]);
  editor.setPositionalAttribute(current.propertyId, 2, { typed: { type: 'IfcText', value: JSON.stringify(spec) } });
  editor.setPositionalAttribute(roofId, 2, spec.name);
  editor.setPositionalAttribute(roofId, 8, `.${roofShape(g)}.`);
  const globalId = new AnchorEntityReader(store, view).entity(roofId)?.attributes[0];
  return { roofId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed };
}
