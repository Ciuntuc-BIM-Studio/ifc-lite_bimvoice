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
import { emitSurfaceStyle, ownerHistoryRef } from './_emit-helpers.js';
import { addMaterialLayerSetToStore, addMaterialLayerSetUsageToStore, addMaterialToStore } from './material.js';
import { pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';

/** One layer of a roof covering, metres; outermost first. */
export interface RoofLayer {
  name: string;
  thickness: number;
  /** Its material's colour (#rrggbb): sections and 3D tell the layers apart by it. Default: the covering's for the first, a neutral one after. */
  color?: string;
}

/** Default colours of the layers under the outermost one. */
const LAYER_COLOURS = ['#4a4a4a', '#e3cf6e', '#b98d5a', '#9aa3ab', '#d9d9d9'];

/** The colour a covering layer's material shows. */
export function layerColour(covering: RoofCovering, index: number): string {
  const own = coveringLayers(covering)[index]?.color;
  if (own) return own;
  return index === 0 ? covering.color : LAYER_COLOURS[(index - 1) % LAYER_COLOURS.length];
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

const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : { red: 0.6, green: 0.6, blue: 0.6 };
};

/** A material's appearance: IfcMaterialDefinitionRepresentation → IfcStyledRepresentation → a styled item with no geometry. */
export function colourMaterial(editor: StoreEditor, anchor: Pick<SpatialAnchor, 'schema' | 'bodyContextId'>, materialId: number, colour: string, name: string): void {
  const style = emitSurfaceStyle(editor, anchor.schema ?? 'IFC4', rgb(colour), name).styleRefId;
  const item = editor.addEntity('IfcStyledItem', [null, [`#${style}`], null]).expressId;
  const rep = editor.addEntity('IfcStyledRepresentation', [`#${anchor.bodyContextId}`, 'Style', 'Material', [`#${item}`]]).expressId;
  editor.addEntity('IfcMaterialDefinitionRepresentation', [null, null, [`#${rep}`], `#${materialId}`]);
}

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
    const layers = coveringLayers(covering);
    layers.forEach((l, i) => {
      if (!materials.has(l.name)) colourMaterial(editor, anchor, material(l.name), layerColour(covering, i), l.name);
    });
    const set = addMaterialLayerSetToStore(editor, anchor, {
      LayerSetName: `${name} covering`,
      MaterialLayers: layers.map((l) => ({ Material: material(l.name), LayerThickness: l.thickness, Name: l.name })),
    });
    // Every plane's Z is square to its slope and its top face is at Z = 0: the layers run down from it.
    const usage = addMaterialLayerSetUsageToStore(editor, anchor, {
      ForLayerSet: set.layerSetId, LayerSetDirection: 'AXIS3', DirectionSense: 'NEGATIVE', OffsetFromReferenceLine: 0,
    });
    associate(editor, anchor, usage.usageId, planes);
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
    // A layer-set usage: its set goes with it.
    const layerSetId = set.type.toUpperCase() === 'IFCMATERIALLAYERSETUSAGE' ? refId(set.attributes[0]) : relating;
    const layerSet = layerSetId === null ? null : reader.entity(layerSetId);
    if (layerSetId === null || !layerSet) continue;
    drop.add(layerSetId);
    if (!Array.isArray(layerSet.attributes[0])) continue; // an IfcMaterial
    for (const l of layerSet.attributes[0]) {
      const layerId = refId(l);
      if (layerId === null) continue;
      drop.add(layerId);
      const mat = refId(reader.entity(layerId)?.attributes[0]);
      if (mat !== null) drop.add(mat);
    }
  }
  // The dropped materials' appearances (they point at the material, nothing points at them).
  const appearances: number[] = [];
  for (const id of [...reader.ids('IFCMATERIALDEFINITIONREPRESENTATION')]) {
    const material = refId(reader.entity(id)?.attributes[3]);
    if (material !== null && drop.has(material)) appearances.push(id);
  }
  for (const id of drop) editor.removeEntity(id);
  pruneOrphanOverlay(editor, appearances);
}
