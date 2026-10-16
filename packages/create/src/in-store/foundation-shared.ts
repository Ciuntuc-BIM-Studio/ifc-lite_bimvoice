/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What both foundations write the same way: their spec as a property set on
 * the root element (JSON, without the material appearances, which the
 * project keeps), their concrete as one IfcMaterial per name, and their
 * catalogue types (IfcWallType / IfcFootingType, `catalog-type.ts`).
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { catalogTypeOfElement, ensureCatalogTypeInStore, rewriteCatalogTypeInStore, type CatalogTypeInput } from './catalog-type.js';
import { assignTypeInStore } from './element-type.js';
import { addMaterialToStore, assignMaterialInStore } from './material.js';
import { emitMaterialAppearance } from './material-appearance.js';
import { readRelatedLists } from './resolve-relations.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { colourMaterial } from './roof-system-material.js';
import type { FoundationMaterial } from './foundation-spec.js';

type Attr = Parameters<StoreEditor['addEntity']>[1];

export const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

/** The spec as stored: the material appearances left out. */
export function storedSpec<T>(spec: T): T {
  return JSON.parse(JSON.stringify(spec, (key, value) => (key === 'appearance' ? undefined : value))) as T;
}

const specValue = (spec: unknown) => ({ typed: { type: 'IfcText', value: JSON.stringify(storedSpec(spec)) } });

export function writeSpecPset(editor: StoreEditor, anchor: SpatialAnchor, elementId: number, psetName: string, spec: unknown): number {
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const prop = editor.addEntity('IfcPropertySingleValue', ['Spec', null, specValue(spec), null] as Attr).expressId;
  const pset = editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), owner, psetName, null, [`#${prop}`]] as Attr).expressId;
  editor.addEntity('IfcRelDefinesByProperties', [generateIfcGuid(anchor.guidRandom), owner, null, null, [`#${elementId}`], `#${pset}`] as Attr);
  return prop;
}

export function updateSpecPset(editor: StoreEditor, propertyId: number, spec: unknown): void {
  editor.setPositionalAttribute(propertyId, 2, specValue(spec) as Attr[number]);
}

/** The spec stored on `elementId` in `psetName`, with the property holding it; null when there is none. */
export function readSpecPset<T>(reader: AnchorEntityReader, elementId: number, psetName: string): { spec: T; propertyId: number } | null {
  for (const relId of reader.ids('IFCRELDEFINESBYPROPERTIES')) {
    const rel = reader.entity(relId);
    if (!rel || !Array.isArray(rel.attributes[4]) || !rel.attributes[4].some((r) => refId(r) === elementId)) continue;
    const set = reader.entity(refId(rel.attributes[5]) ?? -1);
    if (set?.attributes[2] !== psetName) continue;
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const prop = reader.entity(refId(p) ?? -1);
      if (prop?.attributes[0] !== 'Spec') continue;
      const v = prop.attributes[2] as unknown;
      const raw = Array.isArray(v) ? v[1] : v && typeof v === 'object' && 'typed' in v ? (v as { typed: { value: unknown } }).typed.value : v;
      try {
        return { spec: JSON.parse(String(raw)) as T, propertyId: refId(p)! };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The IfcMaterial named `m.name`: the model's, else a new one with its colour and hatches. */
export function foundationMaterialInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, m: FoundationMaterial, view?: MutablePropertyView | null): number {
  const reader = new AnchorEntityReader(store, view ?? editor.getMutationView());
  for (const id of reader.ids('IFCMATERIAL')) if (reader.entity(id)?.attributes[0] === m.name) return id;
  const materialId = addMaterialToStore(editor, anchor, { Name: m.name, Category: 'Concrete' }).materialId;
  if (m.appearance) emitMaterialAppearance(editor, String(anchor.schema ?? 'IFC4'), anchor.bodyContextId, materialId, m.name, { ...m.appearance, color: m.appearance.color ?? m.color });
  else colourMaterial(editor, anchor, materialId, m.color ?? '#a8a8a8', m.name);
  return materialId;
}

/** Give `elementIds` the material `materialId` (leaving any other they had). */
export function assignFoundationMaterial(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, materialId: number, elementIds: readonly number[]): void {
  assignMaterialInStore(editor, anchor, materialId, elementIds, readRelatedLists(store, 'IfcRelAssociatesMaterial', editor.getMutationView()));
}

/**
 * The catalogue type `input` in the model, its entry current (name, spec,
 * layers), and `elementIds` typed by it. Returns its layer set (a layered
 * type) and the usages a rewrite repointed.
 */
export function typeFoundationParts(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, input: CatalogTypeInput, elementIds: readonly number[]): { typeId: number; layerSetId: number | null } {
  const view = editor.getMutationView();
  let type = ensureCatalogTypeInStore(store, editor, anchor, input);
  if (JSON.stringify(type.spec) !== JSON.stringify(input.spec)) {
    const rewritten = rewriteCatalogTypeInStore(store, editor, anchor, type, input);
    type = { ...type, layerSetId: rewritten.layerSetId, spec: input.spec };
  }
  const untyped = elementIds.filter((id) => catalogTypeOfElement(store, id, view)?.typeId !== type.typeId);
  if (untyped.length) assignTypeInStore(editor, anchor, type.typeId, untyped, readRelatedLists(store, 'IfcRelDefinesByType', view));
  return { typeId: type.typeId, layerSetId: type.layerSetId };
}
