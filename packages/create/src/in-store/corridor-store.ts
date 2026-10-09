/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A road corridor in a model: an IfcElementAssembly ('Corridor')
 * aggregating one triangulated element per pavement course (closed) and
 * per earthwork kind (the cut and fill slopes, open surfaces), plus — in
 * IFC4X3 — the IfcAlignment with its horizontal and vertical layouts and
 * the composite / gradient curve geometry (the from-scratch emitter, over
 * the store). Its spec is stored on the assembly as Pset_IfcLiteCorridor,
 * so the block regenerates from the model alone; parts keep their entity
 * and GlobalId across regenerations by their Tag (course:i, cut, fill), the
 * alignment by its GlobalId. A terrain is an IfcGeographicElement TERRAIN
 * with a triangulated body; the corridor refers to it by GlobalId.
 *
 * Classes by schema — IFC4X3: IfcCourse PAVEMENT, IfcEarthworksCut CUT,
 * IfcEarthworksFill EMBANKMENT; IFC4: IfcBuildingElementProxy and
 * IfcGeographicElement with ObjectType. IFC2X3 has no tessellated bodies.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { emitAlignment } from '../ifc-creator-alignment.js';
import type { HorizontalSegment as EmittedHorizontalSegment } from '../landxml/alignment-mapping.js';
import type { VerticalSegment as EmittedVerticalSegment } from '../landxml/profile-geometry.js';
import { buildCorridor, type CorridorModel, type CorridorSpec } from '../civil/corridor.js';
import type { HorizontalAlignment } from '../civil/alignment.js';
import type { VerticalProfile } from '../civil/profile.js';
import { Terrain, type Tin } from '../civil/tin.js';
import { emitLocalPlacement, emitRelContainedInSpatialStructure, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import { refId } from './host-geometry-frame.js';
import { attributeRefs, elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { canonicalEntity, schemaAttributes, schemaRegistry } from './schema-attributes.js';
import { storeEmitter } from './step-attrs.js';
import { addTriangulatedElementToStore, readTriangulatedBody, rewriteTriangulatedGeometry, type TriangulatedBuildResult, type TriangulatedInStoreParams } from './triangulated.js';

type Attr = Parameters<StoreEditor['addEntity']>[1];

export const CORRIDOR_PSET = 'Pset_IfcLiteCorridor';

export interface CorridorResult {
  corridorId: number;
  globalId: string;
  /** Parts written or rewritten (to re-mesh), and parts removed. */
  parts: number[];
  removed: number[];
  alignmentId: number | null;
  model: CorridorModel;
}

function partClass(schema: string, kind: 'course' | 'cut' | 'fill'): Pick<TriangulatedInStoreParams, 'IfcClass' | 'PredefinedType' | 'ObjectType'> {
  if (schema === 'IFC4X3') {
    if (kind === 'course') return { IfcClass: 'IfcCourse', PredefinedType: 'PAVEMENT' };
    return kind === 'cut' ? { IfcClass: 'IfcEarthworksCut', PredefinedType: 'CUT' } : { IfcClass: 'IfcEarthworksFill', PredefinedType: 'EMBANKMENT' };
  }
  if (kind === 'course') return { IfcClass: 'IfcBuildingElementProxy', ObjectType: 'Pavement course' };
  return { IfcClass: 'IfcGeographicElement', PredefinedType: 'USERDEFINED', ObjectType: kind === 'cut' ? 'Cut slopes' : 'Fill slopes' };
}

/** A terrain element from a TIN (storey-local metres). */
export function addTerrainToStore(editor: StoreEditor, anchor: SpatialAnchor, params: { Name: string; tin: Tin; GlobalId?: string; Color?: string }): TriangulatedBuildResult {
  return addTriangulatedElementToStore(editor, anchor, {
    IfcClass: 'IfcGeographicElement', PredefinedType: 'TERRAIN', Name: params.Name, GlobalId: params.GlobalId, Color: params.Color ?? '#7a9a5a',
    Points: params.tin.points, Triangles: params.tin.triangles, Closed: false,
  });
}

/** The element a GlobalId names (parsed or created this session), or null. */
export function elementByGlobalId(store: IfcDataStore, view: MutablePropertyView | null | undefined, globalId: string): number | null {
  const created = view?.getNewEntities().find((e) => e.attributes[0] === globalId && !view.isDeleted(e.expressId));
  if (created) return created.expressId;
  const parsed = store.entities.getExpressIdByGlobalId(globalId) ?? 0;
  return parsed > 0 && !view?.isDeleted(parsed) ? parsed : null;
}

/** The TIN of a terrain element (any element with a triangulated body), storey-local metres. */
export function readTerrainTin(store: IfcDataStore, anchor: SpatialAnchor, elementId: number, view?: MutablePropertyView | null): Tin | null {
  return readTriangulatedBody(new AnchorEntityReader(store, view), anchor, elementId, anchor.storeyPlacementId);
}

/** Every terrain in the model: IfcGeographicElement TERRAIN, by id with name. */
export function terrainsInStore(store: IfcDataStore, view?: MutablePropertyView | null): { id: number; name: string; globalId: string }[] {
  const r = new AnchorEntityReader(store, view);
  const out: { id: number; name: string; globalId: string }[] = [];
  for (const id of r.ids('IFCGEOGRAPHICELEMENT')) {
    const e = r.entity(id);
    const kind = String(e?.attributes[8] ?? '').replace(/\./g, '');
    if (e && (kind === 'TERRAIN' || kind === '')) out.push({ id, name: String(e.attributes[2] ?? `Terrain #${id}`), globalId: String(e.attributes[0] ?? '') });
  }
  return out;
}

/** The emitter's horizontal segments from the built alignment, in the file's units. */
function emittedHorizontal(a: HorizontalAlignment, anchor: SpatialAnchor): EmittedHorizontalSegment[] {
  const n = (v: number) => toNativeLength(anchor, v);
  return a.segments.filter((s) => s.length > 1e-9).map((s, i) => {
    const end = a.pointAt(s.station + s.length);
    const R = s.radius === Infinity ? 0 : n(s.radius) * s.turn;
    const startRadius = s.kind === 'line' || s.kind === 'spiralIn' ? 0 : R;
    const endRadius = s.kind === 'line' || s.kind === 'spiralOut' ? 0 : R;
    return {
      sourceId: `seg:${i}`, type: s.kind === 'line' ? 'LINE' : s.kind === 'arc' ? 'CIRCULARARC' : 'CLOTHOID',
      start: [n(s.start[0]), n(s.start[1])], direction: s.direction, startRadius, endRadius, length: n(s.length),
      end: [n(end.x), n(end.y)], endDirection: end.direction,
      startCurvature: startRadius === 0 ? 0 : 1 / startRadius, endCurvature: endRadius === 0 ? 0 : 1 / endRadius,
    };
  });
}

/** The emitter's vertical segments from the profile: grades and parabolas between its critical stations. */
function emittedVertical(p: VerticalProfile, start: number, end: number, anchor: SpatialAnchor): EmittedVerticalSegment[] {
  const n = (v: number) => toNativeLength(anchor, v);
  const stations = [start, ...p.criticalStations().filter((s) => s > start && s < end), end];
  const out: EmittedVerticalSegment[] = [];
  stations.slice(1).forEach((s1, i) => {
    const s0 = stations[i];
    const L = s1 - s0;
    if (L <= 1e-9) return;
    const g0 = p.gradeAt(s0 + 1e-9), g1 = p.gradeAt(s1 - 1e-9);
    const curved = Math.abs(g1 - g0) > 1e-9;
    out.push({
      sourceId: `v:${i}`, type: curved ? 'PARABOLICARC' : 'CONSTANTGRADIENT', startDistAlong: n(s0 - start), horizontalLength: n(L),
      startHeight: n(p.elevationAt(s0)), startGradient: g0, endGradient: curved ? g1 : g0, radiusOfCurvature: curved ? n(L / (g1 - g0)) : null,
    });
  });
  return out;
}

function writeAlignment(editor: StoreEditor, anchor: SpatialAnchor, spec: CorridorSpec, model: CorridorModel, globalId: string | undefined): number | null {
  if ((anchor.schema ?? 'IFC4') !== 'IFC4X3') return null;
  const registry = schemaRegistry(anchor.schema, 'addCorridorToStore');
  const segments = emittedHorizontal(model.alignment, anchor);
  if (segments.length === 0) return null;
  const result = emitAlignment({
    Name: `${spec.name} alignment`, GlobalId: globalId, StartStation: toNativeLength(anchor, model.alignment.startStation), Segments: segments,
    Vertical: { Name: `${spec.name} profile`, Segments: emittedVertical(model.profile, model.alignment.startStation, model.alignment.endStation, anchor) },
  }, {
    emit: storeEmitter(editor, registry, 'addCorridorToStore'), newGlobalId: () => generateIfcGuid(anchor.guidRandom),
    ownerRef: ownerHistoryRef(anchor.ownerHistoryId) ?? '$', axisContextRef: `#${anchor.axisContextId}`, placementRef: `#${anchor.storeyPlacementId}`,
  });
  emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, result.alignmentId, anchor.storeyId, anchor.guidRandom);
  return result.alignmentId;
}

/** Remove an alignment with everything nested under it; the geometry it alone used is pruned. */
function removeAlignment(r: AnchorEntityReader, editor: StoreEditor, alignmentId: number): number[] {
  const gone: number[] = [];
  const roots: number[] = [];
  const nestedUnder = (id: number): number[] => {
    const out: number[] = [];
    for (const relId of [...r.ids('IFCRELNESTS')]) {
      const rel = r.entity(relId);
      if (!rel || refId(rel.attributes[4]) !== id) continue;
      for (const x of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) { const c = refId(x); if (c !== null) out.push(c); }
      editor.removeEntity(relId);
    }
    return out;
  };
  const drop = (id: number) => {
    const e = r.entity(id);
    if (!e) return;
    for (const child of nestedUnder(id)) drop(child);
    const type = e.type.toUpperCase();
    roots.push(...attributeRefs(editor, id, [5, 6]));
    if (type === 'IFCALIGNMENTSEGMENT') { const d = refId(e.attributes[7]); if (d !== null) editor.removeEntity(d); }
    for (const relId of [...r.ids('IFCRELDEFINESBYPROPERTIES'), ...r.ids('IFCRELCONTAINEDINSPATIALSTRUCTURE')]) {
      const rel = r.entity(relId);
      const list = Array.isArray(rel?.attributes[4]) ? rel.attributes[4] : null;
      if (!rel || !list || !list.some((x) => refId(x) === id)) continue;
      const kept = list.filter((x) => refId(x) !== id);
      if (kept.length) { editor.setPositionalAttribute(relId, 4, kept as Attr[number]); continue; }
      editor.removeEntity(relId);
      if (rel.type.toUpperCase() === 'IFCRELDEFINESBYPROPERTIES') {
        const set = refId(rel.attributes[5]);
        const pset = set === null ? null : r.entity(set);
        if (set !== null && pset) { for (const p of Array.isArray(pset.attributes[4]) ? pset.attributes[4] : []) if (refId(p) !== null) editor.removeEntity(refId(p)!); editor.removeEntity(set); }
      }
    }
    editor.removeEntity(id);
    gone.push(id);
  };
  drop(alignmentId);
  pruneOrphanOverlay(editor, roots);
  return gone;
}

function specProperty(editor: StoreEditor, spec: CorridorSpec): number {
  return editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(spec) } }, null]).expressId;
}

function partParams(schema: string, model: CorridorModel, key: string): TriangulatedInStoreParams {
  const solid = model.solids.find((s) => s.key === key)!;
  return { ...partClass(schema, solid.kind), Name: solid.name, Tag: key, Points: solid.points, Triangles: solid.triangles, Closed: solid.closed, Color: solid.color };
}

export function addCorridorToStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: CorridorSpec, terrain: Tin | null, params: { GlobalId?: string } = {}): CorridorResult {
  const op = 'addCorridorToStore';
  const schema = anchor.schema ?? 'IFC4';
  if (schema === 'IFC2X3') throw new Error(`${op}: corridors need IFC4 or IFC4X3 (tessellated bodies)`);
  const registry = schemaRegistry(anchor.schema, op);
  const model = buildCorridor(spec, terrain ? new Terrain(terrain) : null);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, [0, 0, 0]);
  const globalId = productGuid(params, anchor.guidRandom);
  const assemblyClass = canonicalEntity(registry, 'IfcElementAssembly')!;
  const corridorId = editor.addEntity(assemblyClass, schemaAttributes(registry, assemblyClass, {
    GlobalId: globalId, OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: spec.name, ObjectType: 'Corridor', ObjectPlacement: `#${placementId}`, PredefinedType: 'USERDEFINED',
  }, op) as Attr).expressId;
  emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, corridorId, anchor.storeyId, anchor.guidRandom);
  const parts = model.solids.map((s) => addTriangulatedElementToStore(editor, anchor, partParams(schema, model, s.key)).elementId);
  const alignmentId = writeAlignment(editor, anchor, spec, model, undefined);
  const aggregated = [...parts, ...(alignmentId === null ? [] : [alignmentId])];
  if (aggregated.length) editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${corridorId}`, aggregated.map((id) => `#${id}`)]);
  const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), CORRIDOR_PSET, null, [`#${specProperty(editor, spec)}`]]).expressId;
  editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${corridorId}`], `#${pset}`]);
  return { corridorId, globalId, parts, removed: [], alignmentId, model };
}

interface CorridorRead {
  spec: CorridorSpec;
  propertyId: number;
  aggregateId: number | null;
  parts: { id: number; tag: string; type: string; globalId: string }[];
}

function readCorridorRecord(store: IfcDataStore, corridorId: number, view?: MutablePropertyView | null): CorridorRead | null {
  const r = new AnchorEntityReader(store, view);
  let found: { spec: CorridorSpec; propertyId: number } | null = null;
  for (const relId of r.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = r.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((x) => refId(x) === corridorId)) continue;
    const set = r.entity(refId(rel.attributes[5]) ?? -1);
    if (!set || set.attributes[2] !== CORRIDOR_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = r.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      const v = prop.attributes[2] as unknown;
      const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
      try { found = { spec: JSON.parse(String(raw)) as CorridorSpec, propertyId: refId(p)! }; } catch { found = null; }
    }
  }
  if (!found) return null;
  let aggregateId: number | null = null;
  const parts: CorridorRead['parts'] = [];
  for (const relId of r.ids('IFCRELAGGREGATES')) {
    const rel = r.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== corridorId) continue;
    aggregateId = relId;
    for (const x of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const id = refId(x);
      const part = id === null ? null : r.entity(id);
      if (part && id !== null) parts.push({ id, tag: typeof part.attributes[7] === 'string' ? part.attributes[7] : '', type: part.type.toUpperCase(), globalId: String(part.attributes[0] ?? '') });
    }
  }
  return { ...found, aggregateId, parts };
}

/** The spec stored on a corridor, or null when `corridorId` is not one. */
export function readCorridor(store: IfcDataStore, corridorId: number, view?: MutablePropertyView | null): CorridorSpec | null {
  return readCorridorRecord(store, corridorId, view)?.spec ?? null;
}

/** The parts (courses, slopes, alignment) of a corridor. */
export function corridorParts(store: IfcDataStore, corridorId: number, view?: MutablePropertyView | null): number[] {
  return readCorridorRecord(store, corridorId, view)?.parts.map((p) => p.id) ?? [];
}

/** The corridor an element belongs to (the assembly itself or one of its parts), or null. */
export function corridorOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  if (readCorridorRecord(store, elementId, view)) return elementId;
  const r = new AnchorEntityReader(store, view);
  for (const relId of r.ids('IFCRELAGGREGATES')) {
    const rel = r.entity(relId);
    const parts = rel?.attributes[5];
    if (!Array.isArray(parts) || !parts.some((x) => refId(x) === elementId)) continue;
    const whole = refId(rel!.attributes[4]);
    if (whole !== null && readCorridorRecord(store, whole, view)) return whole;
  }
  return null;
}

/** Every corridor in the model. */
export function corridorsInStore(store: IfcDataStore, view?: MutablePropertyView | null): number[] {
  const r = new AnchorEntityReader(store, view);
  return [...r.ids('IFCELEMENTASSEMBLY')].filter((id) => readCorridorRecord(store, id, view) !== null);
}

export function regenerateCorridorInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, corridorId: number, spec: CorridorSpec, terrain: Tin | null): CorridorResult {
  const view = editor.getMutationView();
  const current = readCorridorRecord(store, corridorId, view);
  if (!current) throw new Error(`#${corridorId} is not a corridor`);
  const schema = anchor.schema ?? 'IFC4';
  const model = buildCorridor(spec, terrain ? new Terrain(terrain) : null);
  const r = new AnchorEntityReader(store, view);
  const oldAlignment = current.parts.find((p) => p.type === 'IFCALIGNMENT') ?? null;
  const existing = new Map(current.parts.filter((p) => p.type !== 'IFCALIGNMENT').map((p) => [p.tag, p.id]));
  const stale = [...existing.values()].flatMap((id) => elementGeometryRefs(editor, id));
  const parts: number[] = [];
  for (const solid of model.solids) {
    const id = existing.get(solid.key);
    const p = partParams(schema, model, solid.key);
    if (id !== undefined) {
      existing.delete(solid.key);
      rewriteTriangulatedGeometry(editor, anchor, id, p);
      editor.setPositionalAttribute(id, 2, p.Name ?? null);
      parts.push(id);
    } else parts.push(addTriangulatedElementToStore(editor, anchor, p).elementId);
  }
  const removed = [...existing.values()];
  for (const id of removed) editor.removeEntity(id);
  pruneOrphanOverlay(editor, stale);
  if (oldAlignment) removeAlignment(r, editor, oldAlignment.id);
  const alignmentId = writeAlignment(editor, anchor, spec, model, oldAlignment?.globalId || undefined);
  const aggregated = [...parts, ...(alignmentId === null ? [] : [alignmentId])];
  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, aggregated.map((id) => `#${id}`));
  else if (aggregated.length) editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${corridorId}`, aggregated.map((id) => `#${id}`)]);
  editor.setPositionalAttribute(current.propertyId, 2, { typed: { type: 'IfcText', value: JSON.stringify(spec) } });
  editor.setPositionalAttribute(corridorId, 2, spec.name);
  const globalId = r.entity(corridorId)?.attributes[0];
  return { corridorId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed, alignmentId, model };
}

/** Delete a corridor whole: its parts, alignment, aggregation, property set and containment. Returns every removed object (the assembly first). */
export function removeCorridorFromStore(store: IfcDataStore, editor: StoreEditor, corridorId: number): number[] {
  const view = editor.getMutationView();
  const current = readCorridorRecord(store, corridorId, view);
  if (!current) throw new Error(`#${corridorId} is not a corridor`);
  const r = new AnchorEntityReader(store, view);
  const alignment = current.parts.find((p) => p.type === 'IFCALIGNMENT') ?? null;
  const parts = current.parts.filter((p) => p.type !== 'IFCALIGNMENT').map((p) => p.id);
  const stale = [corridorId, ...parts].flatMap((id) => elementGeometryRefs(editor, id));
  const gone = new Set([corridorId, ...parts]);
  for (const [type, listAt, single] of [['IFCRELCONTAINEDINSPATIALSTRUCTURE', 4, null], ['IFCRELDEFINESBYPROPERTIES', 4, 5]] as const) {
    for (const relId of [...r.ids(type)]) {
      const rel = r.entity(relId);
      const list = Array.isArray(rel?.attributes[listAt]) ? rel.attributes[listAt] : null;
      if (!rel || !list || !list.some((x) => gone.has(refId(x) ?? -1))) continue;
      const kept = list.filter((x) => !gone.has(refId(x) ?? -1));
      if (kept.length) { editor.setPositionalAttribute(relId, listAt, kept as Attr[number]); continue; }
      editor.removeEntity(relId);
      const set = single === null ? null : refId(rel.attributes[single]);
      const pset = set === null ? null : r.entity(set);
      if (set !== null && pset?.attributes[2] === CORRIDOR_PSET) {
        for (const p of Array.isArray(pset.attributes[4]) ? pset.attributes[4] : []) if (refId(p) !== null) editor.removeEntity(refId(p)!);
        editor.removeEntity(set);
      }
    }
  }
  if (current.aggregateId !== null) editor.removeEntity(current.aggregateId);
  const alignmentGone = alignment ? removeAlignment(r, editor, alignment.id) : [];
  for (const id of parts) editor.removeEntity(id);
  editor.removeEntity(corridorId);
  pruneOrphanOverlay(editor, stale);
  return [corridorId, ...parts, ...alignmentGone];
}
