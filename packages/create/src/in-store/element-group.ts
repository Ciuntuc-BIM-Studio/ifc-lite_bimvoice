/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Model groups, Revit / ArchiCAD style: a named set of elements selected,
 * moved and edited together, written as standard IFC — an IfcGroup
 * (ObjectType 'Model group') and the IfcRelAssignsToGroup that lists its
 * members. Only plain IfcGroup objects count (not systems, zones or
 * structural load groups), and an element belongs to one model group at a
 * time: grouping or adding takes it out of the group it was in. A group
 * left without members is removed.
 */

import { generateIfcGuid, type RandomSource } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { ownerHistoryRef } from './_emit-helpers.js';
import type { SpatialAnchorSchema } from './anchor.js';
import { refId } from './host-geometry-frame.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { canonicalEntity, conformsTo, schemaAttributes, schemaRegistry } from './schema-attributes.js';

type Attr = Parameters<StoreEditor['addEntity']>[1];

export const MODEL_GROUP_TYPE = 'Model group';

export interface GroupAnchor {
  ownerHistoryId: number | null;
  schema?: SpatialAnchorSchema;
  guidRandom?: RandomSource;
}

export interface ModelGroup {
  id: number;
  globalId: string;
  name: string;
  members: number[];
}

interface Assignment { relId: number; groupId: number; members: number[] }

function assignments(r: AnchorEntityReader): Assignment[] {
  const out: Assignment[] = [];
  for (const relId of r.ids('IFCRELASSIGNSTOGROUP')) {
    const rel = r.entity(relId);
    const groupId = refId(rel?.attributes[6]);
    if (!rel || groupId === null) continue;
    const list = Array.isArray(rel.attributes[4]) ? rel.attributes[4] : [];
    out.push({ relId, groupId, members: list.map(refId).filter((id): id is number => id !== null) });
  }
  return out;
}

const isModelGroup = (r: AnchorEntityReader, id: number) => r.entity(id)?.type.toUpperCase() === 'IFCGROUP';

/** Every model group (plain IfcGroup) with its live members. */
export function modelGroups(store: IfcDataStore, view?: MutablePropertyView | null): ModelGroup[] {
  const r = new AnchorEntityReader(store, view);
  const byGroup = new Map<number, Set<number>>();
  for (const a of assignments(r)) {
    if (!isModelGroup(r, a.groupId)) continue;
    const set = byGroup.get(a.groupId) ?? new Set<number>();
    for (const m of a.members) if (r.entity(m)) set.add(m);
    byGroup.set(a.groupId, set);
  }
  const out: ModelGroup[] = [];
  for (const id of r.ids('IFCGROUP')) {
    const g = r.entity(id);
    if (!g || g.type.toUpperCase() !== 'IFCGROUP') continue;
    out.push({ id, globalId: String(g.attributes[0] ?? ''), name: String(g.attributes[2] ?? `Group #${id}`), members: [...(byGroup.get(id) ?? [])] });
  }
  return out;
}

/** The live members of group `groupId`. */
export function groupMembers(store: IfcDataStore, groupId: number, view?: MutablePropertyView | null): number[] {
  const r = new AnchorEntityReader(store, view);
  const set = new Set<number>();
  for (const a of assignments(r)) if (a.groupId === groupId) for (const m of a.members) if (r.entity(m)) set.add(m);
  return [...set];
}

/** The model group an element belongs to, or null. */
export function groupOfElement(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  const r = new AnchorEntityReader(store, view);
  for (const a of assignments(r)) if (a.members.includes(elementId) && isModelGroup(r, a.groupId)) return a.groupId;
  return null;
}

/** The ids that can be grouped: physical elements (IfcElement) that exist. */
export function groupableElements(store: IfcDataStore, ids: Iterable<number>, view: MutablePropertyView | null | undefined, schema: SpatialAnchorSchema | undefined): number[] {
  const r = new AnchorEntityReader(store, view);
  const registry = schemaRegistry(schema, 'groupableElements');
  return [...new Set(ids)].filter((id) => {
    const type = r.entity(id)?.type;
    return !!type && conformsTo(registry, type, 'IfcElement');
  });
}

/** Take `ids` out of every model group (except `keep`); groups left empty are removed. Returns removed group ids. */
function detach(store: IfcDataStore, editor: StoreEditor, ids: ReadonlySet<number>, keep: number | null): number[] {
  const r = new AnchorEntityReader(store, editor.getMutationView());
  const emptied = new Map<number, boolean>();
  for (const a of assignments(r)) {
    if (a.groupId === keep || !isModelGroup(r, a.groupId)) continue;
    const kept = a.members.filter((m) => !ids.has(m) && r.entity(m));
    if (kept.length !== a.members.length) {
      if (kept.length) editor.setPositionalAttribute(a.relId, 4, kept.map((m) => `#${m}`));
      else editor.removeEntity(a.relId);
    }
    emptied.set(a.groupId, (emptied.get(a.groupId) ?? true) && kept.length === 0);
  }
  const removed: number[] = [];
  for (const [groupId, empty] of emptied) {
    if (!empty) continue;
    removeGroupEntity(r, editor, groupId);
    removed.push(groupId);
  }
  return removed;
}

function removeGroupEntity(r: AnchorEntityReader, editor: StoreEditor, groupId: number): void {
  for (const a of assignments(r)) if (a.groupId === groupId && r.entity(a.relId)) editor.removeEntity(a.relId);
  for (const relId of [...r.ids('IFCRELDEFINESBYPROPERTIES')]) {
    const rel = r.entity(relId);
    const list = Array.isArray(rel?.attributes[4]) ? rel.attributes[4] : null;
    if (!rel || !list || !list.some((x) => refId(x) === groupId)) continue;
    const kept = list.filter((x) => refId(x) !== groupId);
    if (kept.length) editor.setPositionalAttribute(relId, 4, kept as Attr[number]);
    else editor.removeEntity(relId);
  }
  editor.removeEntity(groupId);
}

export interface GroupResult {
  groupId: number;
  globalId: string;
  members: number[];
  /** Groups emptied (and removed) because their members moved here. */
  removedGroups: number[];
}

/** A new model group of `members` (taken out of the groups they were in). */
export function createGroupInStore(store: IfcDataStore, editor: StoreEditor, anchor: GroupAnchor, name: string, members: readonly number[]): GroupResult {
  const op = 'createGroupInStore';
  const ids = [...new Set(members)];
  if (ids.length === 0) throw new Error(`${op}: a group needs at least one element`);
  const registry = schemaRegistry(anchor.schema, op);
  const removedGroups = detach(store, editor, new Set(ids), null);
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const globalId = generateIfcGuid(anchor.guidRandom);
  const groupClass = canonicalEntity(registry, 'IfcGroup')!;
  const groupId = editor.addEntity(groupClass, schemaAttributes(registry, groupClass, {
    GlobalId: globalId, OwnerHistory: owner, Name: name, ObjectType: MODEL_GROUP_TYPE,
  }, op) as Attr).expressId;
  const relClass = canonicalEntity(registry, 'IfcRelAssignsToGroup')!;
  editor.addEntity(relClass, schemaAttributes(registry, relClass, {
    GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: owner, RelatedObjects: ids.map((id) => `#${id}`), RelatingGroup: `#${groupId}`,
  }, op) as Attr);
  return { groupId, globalId, members: ids, removedGroups };
}

/** Add elements to a group (out of any other group). Returns the group's members after. */
export function addToGroupInStore(store: IfcDataStore, editor: StoreEditor, anchor: GroupAnchor, groupId: number, ids: readonly number[]): number[] {
  const op = 'addToGroupInStore';
  const view = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  if (!isModelGroup(r, groupId)) throw new Error(`${op}: #${groupId} is not a model group`);
  const adding = new Set(ids);
  detach(store, editor, adding, groupId);
  const own = assignments(r).filter((a) => a.groupId === groupId);
  const current = new Set(own.flatMap((a) => a.members).filter((m) => r.entity(m)));
  const fresh = [...adding].filter((id) => !current.has(id));
  if (fresh.length === 0) return [...current];
  if (own.length) editor.setPositionalAttribute(own[0].relId, 4, [...own[0].members, ...fresh].map((m) => `#${m}`));
  else {
    const registry = schemaRegistry(anchor.schema, op);
    const relClass = canonicalEntity(registry, 'IfcRelAssignsToGroup')!;
    editor.addEntity(relClass, schemaAttributes(registry, relClass, {
      GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), RelatedObjects: fresh.map((id) => `#${id}`), RelatingGroup: `#${groupId}`,
    }, op) as Attr);
  }
  return [...current, ...fresh];
}

/** Take elements out of a group; the group goes when nothing is left in it. */
export function removeFromGroupInStore(store: IfcDataStore, editor: StoreEditor, groupId: number, ids: readonly number[]): { members: number[]; groupRemoved: boolean } {
  const r = new AnchorEntityReader(store, editor.getMutationView());
  const out = new Set(ids);
  const left = new Set<number>();
  for (const a of assignments(r)) {
    if (a.groupId !== groupId) continue;
    const kept = a.members.filter((m) => !out.has(m) && r.entity(m));
    kept.forEach((m) => left.add(m));
    if (kept.length === a.members.length) continue;
    if (kept.length) editor.setPositionalAttribute(a.relId, 4, kept.map((m) => `#${m}`));
    else editor.removeEntity(a.relId);
  }
  if (left.size === 0) {
    removeGroupEntity(r, editor, groupId);
    return { members: [], groupRemoved: true };
  }
  return { members: [...left], groupRemoved: false };
}

/** Dissolve a group: the group and its assignment go, the elements stay. Returns the former members. */
export function ungroupInStore(store: IfcDataStore, editor: StoreEditor, groupId: number): number[] {
  const r = new AnchorEntityReader(store, editor.getMutationView());
  if (!isModelGroup(r, groupId)) throw new Error(`ungroupInStore: #${groupId} is not a model group`);
  const members = groupMembers(store, groupId, editor.getMutationView());
  removeGroupEntity(r, editor, groupId);
  return members;
}

export function renameGroupInStore(editor: StoreEditor, groupId: number, name: string): void {
  editor.setPositionalAttribute(groupId, 2, name);
}
