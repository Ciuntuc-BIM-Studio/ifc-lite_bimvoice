/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The materials of a roof system: the covering's build-up as one
 * IfcMaterialLayerSet (outermost layer first) associated with every covering
 * plane, and the structure's timber as one IfcMaterial associated with every
 * member. Both are written afresh each time the block is (re)generated; the
 * previous ones — associations that relate only parts of the block — are
 * removed first.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { addMaterialLayerSetToStore, addMaterialToStore } from './material.js';
import { AnchorEntityReader } from './resolve-anchor.js';

/** One layer of a roof covering, metres; outermost first. */
export interface RoofLayer {
  name: string;
  thickness: number;
}

export interface RoofCovering {
  /** Total thickness across the slope; the sum of `layers` when there are any. */
  thickness: number;
  color: string;
  layers?: RoofLayer[];
}

/** The covering's layers: its own, or the whole thickness as one layer. */
export function coveringLayers(c: RoofCovering): RoofLayer[] {
  return c.layers?.length ? c.layers : [{ name: 'Roof covering', thickness: c.thickness }];
}

/** The covering's total thickness. */
export function coveringThickness(c: RoofCovering): number {
  return c.layers?.length ? c.layers.reduce((s, l) => s + l.thickness, 0) : c.thickness;
}

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

function associate(editor: StoreEditor, anchor: SpatialAnchor, materialId: number, ids: readonly number[]): void {
  if (ids.length === 0) return;
  editor.addEntity('IfcRelAssociatesMaterial', [
    generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, ids.map((id) => `#${id}`), `#${materialId}`,
  ]);
}

export function writeRoofMaterials(
  editor: StoreEditor, anchor: SpatialAnchor, name: string, covering: RoofCovering, planes: readonly number[], members: readonly number[],
): void {
  const materials = new Map<string, number>();
  const material = (n: string, category?: string) => {
    let id = materials.get(n);
    if (id === undefined) materials.set(n, (id = addMaterialToStore(editor, anchor, { Name: n, Category: category }).materialId));
    return id;
  };
  if (planes.length) {
    const set = addMaterialLayerSetToStore(editor, anchor, {
      LayerSetName: `${name} covering`,
      MaterialLayers: coveringLayers(covering).map((l) => ({ Material: material(l.name), LayerThickness: l.thickness, Name: l.name })),
    });
    associate(editor, anchor, set.layerSetId, planes);
  }
  if (members.length) associate(editor, anchor, material('Timber', 'wood'), members);
}

/** Remove the material associations that relate only `parts`, with the materials they carry. */
export function removeRoofMaterials(store: IfcDataStore, editor: StoreEditor, parts: readonly number[], view?: MutablePropertyView | null): void {
  const own = new Set(parts);
  const reader = new AnchorEntityReader(store, view ?? editor.getMutationView());
  const drop = new Set<number>();
  for (const relId of [...reader.ids('IFCRELASSOCIATESMATERIAL')]) {
    const rel = reader.entity(relId);
    const related = Array.isArray(rel?.attributes[4]) ? rel.attributes[4].map(refId) : [];
    if (!rel || related.length === 0 || !related.every((id) => id !== null && own.has(id))) continue;
    editor.removeEntity(relId);
    const relating = refId(rel.attributes[5]);
    const set = relating === null ? null : reader.entity(relating);
    if (relating === null || !set) continue;
    drop.add(relating);
    if (!Array.isArray(set.attributes[0])) continue; // an IfcMaterial
    for (const l of set.attributes[0]) {
      const layerId = refId(l);
      if (layerId === null) continue;
      drop.add(layerId);
      const mat = refId(reader.entity(layerId)?.attributes[0]);
      if (mat !== null) drop.add(mat);
    }
  }
  for (const id of drop) editor.removeEntity(id);
}
