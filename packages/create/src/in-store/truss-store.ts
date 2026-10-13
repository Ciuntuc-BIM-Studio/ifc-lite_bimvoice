/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A timber truss in a model: an IfcElementAssembly (TRUSS) aggregating one
 * IfcMember per bar (CHORD, POST, STRUT), in the truss's timber class
 * (`timber-member.ts`). Its spec — the pattern and dimensions of `truss.ts`
 * and where it stands (its bottom chord from `start` to `end`, storey-local
 * metres) — is stored on the assembly as Pset_LapinTruss, so the truss
 * regenerates from the model alone.
 *
 * `regenerateTrussInStore` rebuilds it from a changed spec in place: a bar
 * whose key (its Tag) is still generated keeps its entity and GlobalId and
 * gets new geometry; new keys become new parts; parts no longer generated
 * are removed. Where the truss stands is read from its bottom chord as it
 * is now, so a truss moved, rotated or copied (which moves its bars, not
 * its spec) is rebuilt where it is.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { emitLocalPlacement, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { assignMaterialInStore } from './material.js';
import { addMemberToStore } from './member.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { readRelatedLists } from './resolve-relations.js';
import { getModelLengthUnitScale } from './edit/length-unit-scale.js';
import { resolveLinearElementChain } from './edit/linear-element-edit.js';
import { timberMaterialInStore } from './timber-member.js';
import { trussBars, type TrussBar, type TrussRole, type TimberTrussSpec } from './truss.js';

type Vec3 = [number, number, number];
type Attr = Parameters<StoreEditor['addEntity']>[1];

export const TRUSS_PSET = 'Pset_LapinTruss';

/** A truss and where it stands. */
export interface PlacedTrussSpec extends TimberTrussSpec {
  name: string;
  /** The bottom chord's axis ends, storey-local metres (the span is their distance). */
  start: Vec3;
  end: Vec3;
}

export interface TrussResult {
  trussId: number;
  globalId: string;
  /** Parts written or rewritten (to re-mesh), and parts removed. */
  parts: number[];
  removed: number[];
}

const KINDS: Record<TrussRole, { type: 'CHORD' | 'POST' | 'STRUT'; name: string }> = {
  top: { type: 'CHORD', name: 'Top chord' }, bottom: { type: 'CHORD', name: 'Bottom chord' },
  post: { type: 'POST', name: 'Post' }, web: { type: 'STRUT', name: 'Web' },
};

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** The truss's own span from where it stands (the spec's `span` follows it). */
function settled(spec: PlacedTrussSpec): PlacedTrussSpec {
  const span = Math.hypot(spec.end[0] - spec.start[0], spec.end[1] - spec.start[1]);
  return { ...spec, span };
}

/** A bar in storey-local metres: along the span from `start`, up from it. */
function placeBar(spec: PlacedTrussSpec, bar: TrussBar): { a: Vec3; b: Vec3 } {
  const dx = spec.end[0] - spec.start[0], dy = spec.end[1] - spec.start[1];
  const l = Math.hypot(dx, dy);
  const u = [dx / l, dy / l];
  const at = ([x, z]: [number, number]): Vec3 => [spec.start[0] + u[0] * x, spec.start[1] + u[1] * x, spec.start[2] + z];
  return { a: at(bar.a), b: at(bar.b) };
}

function buildBar(editor: StoreEditor, anchor: SpatialAnchor, spec: PlacedTrussSpec, bar: TrussBar, GlobalId?: string): number {
  const { a, b } = placeBar(spec, bar);
  const made = addMemberToStore(editor, anchor, {
    Start: a, End: b, Width: bar.section.width, Height: bar.section.depth,
    PredefinedType: KINDS[bar.role].type, Name: KINDS[bar.role].name, ObjectType: spec.grade, Tag: bar.key, ...(GlobalId ? { GlobalId } : {}),
  });
  // Parts belong to the truss (aggregated), not to the storey directly.
  editor.removeEntity(made.relContainedId);
  return made.memberId;
}

function specProperty(editor: StoreEditor, spec: PlacedTrussSpec): number {
  return editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(spec) } }, null] as Attr).expressId;
}

function assignTimber(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, grade: string, parts: readonly number[]): void {
  if (parts.length === 0) return;
  const view = editor.getMutationView();
  assignMaterialInStore(editor, anchor, timberMaterialInStore(store, editor, anchor, grade, view), parts, readRelatedLists(store, 'IfcRelAssociatesMaterial', view));
}

/** Write a truss: the assembly, a member per bar, their timber, its spec. */
export function addTrussToStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, input: PlacedTrussSpec, params: { GlobalId?: string } = {}): TrussResult {
  const spec = settled(input);
  const bars = trussBars(spec);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, [0, 0, 0]);
  const globalId = productGuid(params, anchor.guidRandom);
  const trussId = editor.addEntity('IfcElementAssembly', [
    globalId, ownerHistoryRef(anchor.ownerHistoryId), spec.name, null, spec.grade, `#${placementId}`, null, null, '.FACTORY.', '.TRUSS.',
  ] as Attr).expressId;
  editor.addEntity('IfcRelContainedInSpatialStructure', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${trussId}`], `#${anchor.storeyId}`] as Attr);
  const parts = bars.map((bar) => buildBar(editor, anchor, spec, bar));
  editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${trussId}`, parts.map((id) => `#${id}`)] as Attr);
  assignTimber(store, editor, anchor, spec.grade, parts);
  const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), TRUSS_PSET, null, [`#${specProperty(editor, spec)}`]] as Attr).expressId;
  editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, [`#${trussId}`], `#${pset}`] as Attr);
  return { trussId, globalId, parts, removed: [] };
}

interface TrussRead {
  spec: PlacedTrussSpec;
  propertyId: number;
  aggregateId: number | null;
  parts: { id: number; tag: string }[];
}

function readTrussRecord(store: IfcDataStore, trussId: number, view?: MutablePropertyView | null): TrussRead | null {
  const reader = new AnchorEntityReader(store, view);
  let found: { spec: PlacedTrussSpec; propertyId: number } | null = null;
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === trussId)) continue;
    const set = reader.entity(refId(rel.attributes[5]) ?? -1);
    if (set?.attributes[2] !== TRUSS_PSET) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      const v = prop.attributes[2] as unknown;
      const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
      try {
        found = { spec: JSON.parse(String(raw)) as PlacedTrussSpec, propertyId: refId(p)! };
      } catch (err) {
        console.warn(`[truss] #${trussId}: unreadable ${TRUSS_PSET}`, err);
      }
    }
  }
  if (!found) return null;
  let aggregateId: number | null = null;
  const parts: { id: number; tag: string }[] = [];
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== trussId) continue;
    aggregateId = relId;
    for (const r of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const id = refId(r);
      const part = id === null ? null : reader.entity(id);
      if (part && id !== null) parts.push({ id, tag: typeof part.attributes[7] === 'string' ? part.attributes[7] : '' });
    }
  }
  return { ...found, aggregateId, parts };
}

/** The spec stored on a truss, or null when `trussId` is not one. */
export function readTruss(store: IfcDataStore, trussId: number, view?: MutablePropertyView | null): PlacedTrussSpec | null {
  return readTrussRecord(store, trussId, view)?.spec ?? null;
}

/** The truss an element belongs to (the assembly itself, or one of its bars), or null. */
export function trussOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  if (readTrussRecord(store, elementId, view)) return elementId;
  const reader = new AnchorEntityReader(store, view);
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    const parts = rel?.attributes[5];
    if (!Array.isArray(parts) || !parts.some((r) => refId(r) === elementId)) continue;
    const truss = refId(rel!.attributes[4]);
    if (truss !== null && readTrussRecord(store, truss, view)) return truss;
  }
  return null;
}

/** Where a truss stands now: its bottom chord's axis ends (storey-local), or null without one. */
function standing(store: IfcDataStore, editor: StoreEditor, parts: readonly { id: number; tag: string }[]): { start: Vec3; end: Vec3 } | null {
  const bottom = parts.find((p) => p.tag === 'bottom');
  const chain = bottom ? resolveLinearElementChain(store, editor.getMutationView(), editor, bottom.id, getModelLengthUnitScale(store)) : null;
  if (!chain) return null;
  const [x, y, z] = chain.startCoordinates;
  const [dx, dy, dz] = chain.axisDirection;
  return { start: [x, y, z], end: [x + dx * chain.depth, y + dy * chain.depth, z + dz * chain.depth] };
}

/** The spec of truss `trussId` standing where its bottom chord is now (a moved or copied truss). */
export function readPlacedTruss(store: IfcDataStore, editor: StoreEditor, trussId: number): PlacedTrussSpec | null {
  const current = readTrussRecord(store, trussId, editor.getMutationView());
  if (!current) return null;
  return settled({ ...current.spec, ...standing(store, editor, current.parts) });
}

/** Rebuild truss `trussId` from a changed spec, where it stands now, keeping the GlobalIds of the bars still generated. */
export function regenerateTrussInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, trussId: number, input: PlacedTrussSpec): TrussResult {
  const view = editor.getMutationView();
  const current = readTrussRecord(store, trussId, view);
  if (!current) throw new Error(`#${trussId} is not a truss`);
  const spec = settled({ ...input, ...standing(store, editor, current.parts) });
  const bars = trussBars(spec);
  const existing = new Map(current.parts.map((p) => [p.tag, p.id]));
  const stale = current.parts.flatMap((p) => elementGeometryRefs(editor, p.id));
  const parts: number[] = [];
  const fresh: number[] = [];
  for (const bar of bars) {
    const id = existing.get(bar.key);
    if (id === undefined) {
      const made = buildBar(editor, anchor, spec, bar);
      parts.push(made);
      fresh.push(made);
      continue;
    }
    existing.delete(bar.key);
    // The new geometry on a scratch member, moved over to the kept one.
    const scratch = buildBar(editor, anchor, spec, bar);
    const attrs = view.getNewEntity(scratch)!.attributes;
    editor.setPositionalAttribute(id, 5, attrs[5] as Attr[number]);
    editor.setPositionalAttribute(id, 6, attrs[6] as Attr[number]);
    editor.setPositionalAttribute(id, 8, attrs[8] as Attr[number]);
    editor.setPositionalAttribute(id, 4, spec.grade);
    editor.removeEntity(scratch);
    parts.push(id);
  }
  const removed = [...existing.values()];
  for (const id of removed) editor.removeEntity(id);
  pruneOrphanOverlay(editor, stale);
  if (current.aggregateId !== null) editor.setPositionalAttribute(current.aggregateId, 5, parts.map((id) => `#${id}`));
  else editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, `#${trussId}`, parts.map((id) => `#${id}`)] as Attr);
  // A changed class moves every bar to its material; new bars join it either way.
  if (spec.grade !== current.spec.grade) assignTimber(store, editor, anchor, spec.grade, parts);
  else assignTimber(store, editor, anchor, spec.grade, fresh);
  editor.setPositionalAttribute(current.propertyId, 2, { typed: { type: 'IfcText', value: JSON.stringify(spec) } } as Attr[number]);
  editor.setPositionalAttribute(trussId, 2, spec.name);
  editor.setPositionalAttribute(trussId, 4, spec.grade);
  const globalId = new AnchorEntityReader(store, view).entity(trussId)?.attributes[0];
  return { trussId, globalId: typeof globalId === 'string' ? globalId : '', parts, removed };
}

/** The bars of truss `trussId` (its parts). */
export function trussParts(store: IfcDataStore, trussId: number, view?: MutablePropertyView | null): number[] {
  return readTrussRecord(store, trussId, view)?.parts.map((p) => p.id) ?? [];
}
