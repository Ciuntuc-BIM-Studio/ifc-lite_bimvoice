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
import { addFacetedElementToStore, rewriteFacetedGeometry } from './faceted.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { addMemberToStore } from './member.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { roofSolidFaces } from './roof-surface.js';
import { roofGeometry, type RoofEdgeRule, type RoofGeometry } from './roof-system.js';
import { roofStructure, type RoofMember, type RoofStructureSpec } from './roof-structure.js';
import { coveringThickness, removeRoofMaterials, writeRoofMaterials, type RoofCovering } from './roof-system-material.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Attr = Parameters<StoreEditor['addEntity']>[1];

export const ROOF_SYSTEM_PSET = 'Pset_IfcLiteRoofSystem';

export interface RoofSystemSpec {
  /** The drafting contour (or project item) the system was made from. */
  id?: string;
  /** The project roof type it was made from (its covering and structure follow that type). */
  typeId?: string;
  name: string;
  /** Wall-plate line, storey-local metres. */
  outline: Vec2[];
  rules: RoofEdgeRule[];
  /** Wall plate above the storey, metres. */
  eaveHeight: number;
  covering: RoofCovering;
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

/**
 * A roof plane's own frame: origin on its top surface, Z its upward normal,
 * X along its contour lines (level, as an eave runs), Y up the slope.
 */
function planeFrame(top: readonly Vec3[]): { origin: Vec3; x: Vec3; z: Vec3; toLocal: (p: Vec3) => Vec3 } {
  // Newell's normal: robust for any planar loop.
  const n: Vec3 = [0, 0, 0];
  top.forEach((p, i) => {
    const q = top[(i + 1) % top.length];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  });
  const unit = (v: Vec3): Vec3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  let z = unit(n);
  if (z[2] < 0) z = [-z[0], -z[1], -z[2]];
  const level = Math.hypot(z[0], z[1]) < 1e-9 ? [1, 0, 0] as Vec3 : unit([-z[1], z[0], 0]);
  const y: Vec3 = [z[1] * level[2] - z[2] * level[1], z[2] * level[0] - z[0] * level[2], z[0] * level[1] - z[1] * level[0]];
  const origin = top[0];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    origin, x: level, z,
    toLocal: (p) => {
      const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      return [dot(d, level), dot(d, y), dot(d, z)];
    },
  };
}

interface PartPlan {
  key: string;
  build: (globalId: string | undefined) => { id: number; shape: number };
  /** New geometry for an existing part: placement and representation written onto it (the old ones are left to prune). */
  rewrite: (id: number) => number;
}

function partPlans(editor: StoreEditor, anchor: SpatialAnchor, spec: RoofSystemSpec, g: RoofGeometry, members: RoofMember[]): PartPlan[] {
  const lift = spec.eaveHeight;
  const plans: PartPlan[] = [];
  g.planes.forEach((plane) => {
    const tv = coveringThickness(spec.covering) / Math.cos((plane.pitch * Math.PI) / 180);
    const bottom = plane.pts.map(([x, y, z]) => [x, y, z - tv] as Vec3);
    // Each plane in its own frame, Z square to the slope: its layer-set usage (AXIS3) stacks the layers across it.
    const frame = planeFrame(plane.pts.map(([x, y, z]) => [x, y, z + lift] as Vec3));
    const params = {
      IfcClass: 'IfcSlab', PredefinedType: 'ROOF', Name: `${spec.name} plane ${plane.edge + 1}`, Tag: `plane:${plane.edge}`,
      Faces: roofSolidFaces([bottom], tv).map((face) => face.map(([x, y, z]) => frame.toLocal([x, y, z + lift]))),
      Location: frame.origin, Axis: frame.z, RefDirection: frame.x,
    };
    plans.push({
      key: params.Tag,
      build: (GlobalId) => {
        const made = addFacetedElementToStore(editor, anchor, { ...params, GlobalId });
        editor.removeEntity(made.relContainedId);
        return { id: made.elementId, shape: made.productShapeId };
      },
      rewrite: (id) => rewriteFacetedGeometry(editor, anchor, id, params).productShapeId,
    });
  });
  const kinds: Record<RoofMember['role'], { type: 'RAFTER' | 'PURLIN' | 'PLATE' | 'MEMBER' | 'CHORD' | 'POST' | 'STRUT'; name: string }> = {
    rafter: { type: 'RAFTER', name: 'Rafter' }, hip: { type: 'RAFTER', name: 'Hip rafter' }, valley: { type: 'RAFTER', name: 'Valley rafter' },
    ridge: { type: 'MEMBER', name: 'Ridge beam' }, purlin: { type: 'PURLIN', name: 'Purlin' }, plate: { type: 'PLATE', name: 'Wall plate' },
    chord: { type: 'CHORD', name: 'Truss top chord' }, tie: { type: 'CHORD', name: 'Truss bottom chord' }, post: { type: 'POST', name: 'King post' }, strut: { type: 'STRUT', name: 'Strut' },
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

/** Covering planes and members told apart by their Tag. */
function writeMaterials(editor: StoreEditor, anchor: SpatialAnchor, spec: RoofSystemSpec, parts: readonly number[]): void {
  const view = editor.getMutationView();
  const isPlane = (id: number) => String(view.getNewEntity(id)?.attributes[7] ?? '').startsWith('plane:');
  writeRoofMaterials(editor, anchor, spec.name, spec.covering, parts.filter(isPlane), parts.filter((id) => !isPlane(id)));
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
  writeMaterials(editor, anchor, spec, parts);
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

/** The parts (planes and members) of roof system `roofId`. */
export function roofSystemParts(store: IfcDataStore, roofId: number, view?: MutablePropertyView | null): number[] {
  return readRoof(store, roofId, view)?.parts.map((p) => p.id) ?? [];
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
  removeRoofMaterials(store, editor, current.parts.map((p) => p.id), view);
  const existing = new Map(current.parts.map((p) => [p.tag, p.id]));
  // Every part's current placement and body: rewritten or removed below, then pruned once.
  const stale = current.parts.flatMap((p) => elementGeometryRefs(editor, p.id));
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
  pruneOrphanOverlay(editor, stale);
  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, parts.map((id) => `#${id}`));
  else if (parts.length) editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${roofId}`, parts.map((id) => `#${id}`)]);
  writeMaterials(editor, anchor, spec, parts);
  editor.setPositionalAttribute(current.propertyId, 2, { typed: { type: 'IfcText', value: JSON.stringify(spec) } });
  editor.setPositionalAttribute(roofId, 2, spec.name);
  editor.setPositionalAttribute(roofId, 8, `.${roofShape(g)}.`);
  const globalId = new AnchorEntityReader(store, view).entity(roofId)?.attributes[0];
  return { roofId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed };
}

/**
 * Delete roof system `roofId` whole: its parts, their materials, the
 * aggregation, its property set and its containment. Returns every removed
 * element (the roof first).
 */
export function removeRoofSystemFromStore(store: IfcDataStore, editor: StoreEditor, roofId: number): number[] {
  const view = editor.getMutationView();
  const current = readRoof(store, roofId, view);
  if (!current) throw new Error(`#${roofId} is not a roof system`);
  const parts = current.parts.map((p) => p.id);
  const stale = [roofId, ...parts].flatMap((id) => elementGeometryRefs(editor, id));
  removeRoofMaterials(store, editor, parts, view);
  const gone = new Set([roofId, ...parts]);
  const reader = new AnchorEntityReader(store, view);
  // Relationships listing the roof or its parts: dropped when nothing else is left in them.
  for (const [type, listAt, single] of [['IFCRELCONTAINEDINSPATIALSTRUCTURE', 4, null], ['IFCRELDEFINESBYPROPERTIES', 4, 5]] as const) {
    for (const relId of [...reader.ids(type)]) {
      const rel = reader.entity(relId);
      const list = Array.isArray(rel?.attributes[listAt]) ? rel.attributes[listAt] : null;
      if (!rel || !list || !list.some((r) => gone.has(refId(r) ?? -1))) continue;
      const kept = list.filter((r) => !gone.has(refId(r) ?? -1));
      if (kept.length) { editor.setPositionalAttribute(relId, listAt, kept as Attr[number]); continue; }
      editor.removeEntity(relId);
      const set = single === null ? null : refId(rel.attributes[single]);
      const pset = set === null ? null : reader.entity(set);
      if (set !== null && pset?.attributes[2] === ROOF_SYSTEM_PSET) {
        for (const p of Array.isArray(pset.attributes[4]) ? pset.attributes[4] : []) if (refId(p) !== null) editor.removeEntity(refId(p)!);
        editor.removeEntity(set);
      }
    }
  }
  if (current.aggregateId !== null) editor.removeEntity(current.aggregateId);
  for (const id of parts) editor.removeEntity(id);
  editor.removeEntity(roofId);
  pruneOrphanOverlay(editor, stale);
  return [roofId, ...parts];
}
