/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A wall built as a timber frame (IFC's elemented wall): the wall stays the
 * element — axis, joins, openings, type — and aggregates its pieces
 * (`timber-frame.ts`): IfcMember PLATE / STUD / MEMBER for the framing, in
 * its timber class, and IfcPlate SHEET for the boards, in their materials.
 * The wall's own solid body is kept (its axis and size are read from it) but
 * no longer drawn: its representation type becomes 'Reference', so plans,
 * sections and 3D show the frame. The frame's spec, and the body's type to
 * restore, are stored on the wall as Pset_LapinTimberFrame.
 *
 * `syncTimberFrameInStore` rebuilds the pieces from the wall as it is now —
 * moved, lengthened, retyped, with openings added or moved — keeping the
 * GlobalIds of the pieces whose key is still generated.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { getModelLengthUnitScale } from './edit/length-unit-scale.js';
import { addFacetedElementToStore, rewriteFacetedGeometry, type FacetedInStoreParams } from './faceted.js';
import { readHostOpeningExtents } from './hosted-element.js';
import { addMaterialToStore, assignMaterialInStore } from './material.js';
import { emitMaterialAppearance } from './material-appearance.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { readRelatedLists } from './resolve-relations.js';
import { timberMaterialInStore } from './timber-member.js';
import { boxFaces, timberFrameParts, type FrameOpening, type FramePiece, type FramePieceRole, type TimberFrameSpec } from './timber-frame.js';
import { readWallMetres } from './wall-size-edit.js';

export const TIMBER_FRAME_PSET = 'Pset_LapinTimberFrame';
/** The representation type that keeps a framed wall's own body out of the drawings. */
const HIDDEN_BODY = 'Reference';

type Attr = Parameters<StoreEditor['addEntity']>[1];
type Vec3 = [number, number, number];

interface FrameRecord { spec: TimberFrameSpec; bodyType: string }
interface FrameRead { record: FrameRecord; propertyId: number; aggregateId: number | null; parts: { id: number; tag: string }[] }

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};
const textOf = (v: unknown): string | null => {
  const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
  return typeof raw === 'string' ? raw : null;
};

const KINDS: Record<FramePieceRole, { cls: 'IfcMember' | 'IfcPlate'; type: string; name: string }> = {
  plate: { cls: 'IfcMember', type: 'PLATE', name: 'Plate' }, stud: { cls: 'IfcMember', type: 'STUD', name: 'Stud' },
  king: { cls: 'IfcMember', type: 'STUD', name: 'King stud' }, jack: { cls: 'IfcMember', type: 'STUD', name: 'Jack stud' },
  cripple: { cls: 'IfcMember', type: 'STUD', name: 'Cripple stud' }, header: { cls: 'IfcMember', type: 'MEMBER', name: 'Header' },
  sill: { cls: 'IfcMember', type: 'MEMBER', name: 'Sill' }, nogging: { cls: 'IfcMember', type: 'MEMBER', name: 'Nogging' },
  sheathing: { cls: 'IfcPlate', type: 'SHEET', name: 'Sheathing' }, lining: { cls: 'IfcPlate', type: 'SHEET', name: 'Lining' },
};

function readFrame(store: IfcDataStore, wallId: number, view?: MutablePropertyView | null): FrameRead | null {
  const reader = new AnchorEntityReader(store, view);
  let found: { record: FrameRecord; propertyId: number } | null = null;
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === wallId)) continue;
    const set = reader.entity(refId(rel.attributes[5]) ?? -1);
    if (set?.attributes[2] !== TIMBER_FRAME_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      try {
        found = { record: JSON.parse(textOf(prop.attributes[2]) ?? '') as FrameRecord, propertyId: refId(p)! };
      } catch (err) {
        console.warn(`[timber-frame] wall #${wallId}: unreadable ${TIMBER_FRAME_PSET}`, err);
      }
    }
  }
  if (!found) return null;
  let aggregateId: number | null = null;
  const parts: { id: number; tag: string }[] = [];
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== wallId) continue;
    aggregateId = relId;
    for (const r of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const id = refId(r);
      const part = id === null ? null : reader.entity(id);
      if (part && id !== null) parts.push({ id, tag: typeof part.attributes[7] === 'string' ? part.attributes[7] : '' });
    }
  }
  return { ...found, aggregateId, parts };
}

/** A wall's timber frame spec, or null when it is not framed. */
export function readTimberFrame(store: IfcDataStore, wallId: number, view?: MutablePropertyView | null): TimberFrameSpec | null {
  return readFrame(store, wallId, view)?.record.spec ?? null;
}

/** The pieces of a framed wall. */
export function timberFramePieces(store: IfcDataStore, wallId: number, view?: MutablePropertyView | null): number[] {
  return readFrame(store, wallId, view)?.parts.map((p) => p.id) ?? [];
}

/** Every framed wall of the model. */
export function timberFramedWalls(store: IfcDataStore, view?: MutablePropertyView | null): number[] {
  const reader = new AnchorEntityReader(store, view);
  const out: number[] = [];
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    const set = rel ? reader.entity(refId(rel.attributes[5]) ?? -1) : null;
    if (set?.attributes[2] !== TIMBER_FRAME_PSET || !Array.isArray(rel!.attributes[4])) continue;
    for (const r of rel!.attributes[4]) { const id = refId(r); if (id !== null && reader.entity(id)) out.push(id); }
  }
  return out;
}

function bodyRep(reader: AnchorEntityReader, wallId: number): number | null {
  const shape = reader.entity(refId(reader.entity(wallId)?.attributes[6]) ?? -1);
  const reps = Array.isArray(shape?.attributes[2]) ? (shape!.attributes[2] as unknown[]).map(refId).filter((x): x is number => x !== null) : [];
  return reps.find((id) => reader.entity(id)?.attributes[1] === 'Body') ?? reps[0] ?? null;
}

function materialNamed(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, name: string): number {
  const reader = new AnchorEntityReader(store, editor.getMutationView());
  for (const id of reader.ids('IFCMATERIAL')) if (reader.entity(id)?.attributes[0] === name) return id;
  const materialId = addMaterialToStore(editor, anchor, { Name: name }).materialId;
  // A new board material shows as what its name says: wood-based boards light timber, gypsum and plaster off-white.
  const color = /osb|plywood|wood|timber|chip|fibre|fiber/i.test(name) ? '#d6b57a' : /gyps|plaster|drywall/i.test(name) ? '#ece9e2' : null;
  const bodyContextId = reader.contextId('body', reader.rootContextId());
  if (color && bodyContextId !== null) emitMaterialAppearance(editor, String(anchor.schema ?? store.schemaVersion ?? 'IFC4'), bodyContextId, materialId, name, { color });
  return materialId;
}

/** The wall's size and openings in its own frame (metres), and where its frame sits in the storey. */
function wallFrame(store: IfcDataStore, editor: StoreEditor, wallId: number) {
  const view = editor.getMutationView();
  const m = readWallMetres({ dataStore: store, view, editor }, wallId);
  if (!m || !(m.height > 0)) throw new Error(`#${wallId} is not a wall with a plain extruded body`);
  const length = Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]);
  const dir: Vec3 = [(m.end[0] - m.start[0]) / length, (m.end[1] - m.start[1]) / length, 0];
  const scale = getModelLengthUnitScale(store);
  const openings: FrameOpening[] = readHostOpeningExtents(store, wallId, view).cuts.map((c) => ({
    x0: c.bounds.min[0] * scale, x1: c.bounds.max[0] * scale, z0: c.bounds.min[2] * scale, z1: c.bounds.max[2] * scale,
  }));
  return { wall: { length, height: m.height, thickness: m.thickness }, openings, start: m.start as Vec3, dir };
}

function pieceParams(piece: FramePiece, at: { start: Vec3; dir: Vec3 }): FacetedInStoreParams {
  const k = KINDS[piece.role];
  return { IfcClass: k.cls, PredefinedType: k.type, Name: k.name, Tag: piece.key, Faces: boxFaces(piece.box), Location: at.start, Axis: [0, 0, 1], RefDirection: at.dir };
}

function assignMaterials(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: TimberFrameSpec, pieces: readonly { id: number; role: FramePieceRole }[]): void {
  const view = editor.getMutationView();
  const groups = new Map<number, number[]>();
  for (const p of pieces) {
    const material = p.role === 'sheathing' ? materialNamed(store, editor, anchor, spec.sheathing!.material)
      : p.role === 'lining' ? materialNamed(store, editor, anchor, spec.lining!.material)
        : timberMaterialInStore(store, editor, anchor, spec.grade, view);
    groups.set(material, [...(groups.get(material) ?? []), p.id]);
  }
  for (const [material, ids] of groups) assignMaterialInStore(editor, anchor, material, ids, readRelatedLists(store, 'IfcRelAssociatesMaterial', view));
}

/**
 * Frame wall `wallId` with `spec` (a framed wall: change its spec), or take
 * its frame off (`spec` null: the pieces go, the wall's body shows again).
 * Returns the elements to re-mesh and the pieces removed.
 */
export function setTimberFrameInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, wallId: number, spec: TimberFrameSpec | null): { remesh: number[]; removed: number[] } {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const current = readFrame(store, wallId, view);
  const rep = bodyRep(reader, wallId);
  if (rep === null) throw new Error(`#${wallId} has no body`);
  if (!spec) {
    if (!current) return { remesh: [], removed: [] };
    const stale = current.parts.flatMap((p) => elementGeometryRefs(editor, p.id));
    for (const p of current.parts) editor.removeEntity(p.id);
    if (current.aggregateId !== null) editor.removeEntity(current.aggregateId);
    pruneOrphanOverlay(editor, stale);
    editor.setPositionalAttribute(rep, 2, current.record.bodyType);
    for (const relId of [...reader.ids('IFCRELDEFINESBYPROPERTIES')]) {
      const rel = reader.entity(relId);
      const set = rel ? reader.entity(refId(rel.attributes[5]) ?? -1) : null;
      if (set?.attributes[2] === TIMBER_FRAME_PSET && Array.isArray(rel!.attributes[4]) && rel!.attributes[4].some((r) => refId(r) === wallId)) {
        editor.removeEntity(relId);
        editor.removeEntity(refId(rel!.attributes[5])!);
        editor.removeEntity(current.propertyId);
      }
    }
    return { remesh: [wallId], removed: current.parts.map((p) => p.id) };
  }
  const bodyType = current?.record.bodyType ?? String(reader.entity(rep)?.attributes[2] ?? 'SweptSolid');
  const record: FrameRecord = { spec, bodyType };
  if (current) {
    editor.setPositionalAttribute(current.propertyId, 2, { typed: { type: 'IfcText', value: JSON.stringify(record) } } as Attr[number]);
  } else {
    const prop = editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(record) } }, null] as Attr).expressId;
    const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), TIMBER_FRAME_PSET, null, [`#${prop}`]] as Attr).expressId;
    editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${wallId}`], `#${pset}`] as Attr);
  }
  editor.setPositionalAttribute(rep, 2, HIDDEN_BODY);
  return syncTimberFrameInStore(store, editor, anchor, wallId);
}

/** Rebuild a framed wall's pieces from the wall as it is now. Nothing for a wall that is not framed. */
export function syncTimberFrameInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, wallId: number): { remesh: number[]; removed: number[] } {
  const view = editor.getMutationView();
  const current = readFrame(store, wallId, view);
  if (!current) return { remesh: [], removed: [] };
  const at = wallFrame(store, editor, wallId);
  const pieces = timberFrameParts(current.record.spec, at.wall, at.openings);
  const existing = new Map(current.parts.map((p) => [p.tag, p.id]));
  const stale = current.parts.flatMap((p) => elementGeometryRefs(editor, p.id));
  const parts: { id: number; role: FramePieceRole }[] = [];
  for (const piece of pieces) {
    const params = pieceParams(piece, at);
    const id = existing.get(piece.key);
    if (id !== undefined) {
      existing.delete(piece.key);
      rewriteFacetedGeometry(editor, anchor, id, params);
      parts.push({ id, role: piece.role });
    } else {
      const made = addFacetedElementToStore(editor, anchor, params);
      // Pieces belong to the wall (aggregated), not to the storey directly.
      editor.removeEntity(made.relContainedId);
      parts.push({ id: made.elementId, role: piece.role });
    }
  }
  const removed = [...existing.values()];
  for (const id of removed) editor.removeEntity(id);
  pruneOrphanOverlay(editor, stale);
  const list = parts.map((p) => `#${p.id}`);
  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, list);
  else editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${wallId}`, list] as Attr);
  assignMaterials(store, editor, anchor, current.record.spec, parts);
  return { remesh: [wallId, ...parts.map((p) => p.id)], removed };
}
