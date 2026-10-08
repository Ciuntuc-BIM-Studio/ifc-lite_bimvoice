/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A project catalogue type in a model: the IfcWallType / IfcSlabType /
 * IfcColumnType / IfcBeamType … an entry of the project's type catalogue is
 * written as, so occurrences placed with it, schedules and other tools see
 * one type. The entry travels with the type as `Pset_IfcLiteType` (Id, Spec
 * as JSON), which is how it is found again; a layered entry (walls, slabs)
 * also carries its IfcMaterialLayerSet on the type — each layer's material
 * coloured, so 3D and sections tell the layers apart — and its occurrences
 * use it through their own IfcMaterialLayerSetUsage.
 *
 * `rewriteCatalogTypeInStore` follows a changed entry: name and mark, the
 * stored spec, and a new layer set that every usage of the old one now
 * points to (the old set, its layers and materials go when unused). Fitting
 * the occurrences' geometry to the entry is the caller's (it needs the
 * viewer's size edits).
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { toNativeLength } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { addElementTypeToStore } from './element-type.js';
import { addMaterialLayerSetToStore, addMaterialToStore } from './material.js';
import { pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { readRelatedLists } from './resolve-relations.js';
import { colourMaterial } from './roof-system-material.js';

type Attr = Parameters<StoreEditor['addEntity']>[1][number];

export const CATALOG_TYPE_PSET = 'Pset_IfcLiteType';

/** IfcTypeObject.HasPropertySets and IfcElementType.Tag (the same in IFC2X3, IFC4 and IFC4X3). */
const HAS_PROPERTY_SETS = 5;
const NAME = 2;
const TAG = 7;

export interface CatalogTypeLayer {
  name: string;
  /** Metres. */
  thickness: number;
  /** #rrggbb. */
  color?: string;
}

export interface CatalogTypeInput {
  /** The catalogue entry's id. */
  id: string;
  /** The type object's class, e.g. 'IfcWallType'. */
  ifcClass: string;
  name: string;
  mark?: string;
  /** Layers through the element (exterior / top first); absent: no layer set. */
  layers?: CatalogTypeLayer[];
  /** The catalogue entry, stored as JSON. */
  spec: unknown;
}

export interface CatalogTypeInModel {
  id: string;
  typeId: number;
  layerSetId: number | null;
  spec: unknown;
}

/** What a type needs of an anchor: owner history, schema, units, and a context for material colours. */
export type CatalogAnchor = Pick<SpatialAnchor, 'ownerHistoryId' | 'schema' | 'guidRandom' | 'lengthUnitScale' | 'bodyContextId'>;

const refId = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};

function nominal(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 2 && typeof value[0] === 'string' ? value[1] : value[0];
  if (value && typeof value === 'object' && 'typed' in value) return (value as { typed: { value: unknown } }).typed.value;
  if (value && typeof value === 'object' && 'value' in value) return (value as { value: unknown }).value;
  return value;
}

const PALETTE = ['#b5651d', '#e3cf6e', '#9aa3ab', '#d9d9d9', '#6b6b6b', '#c8a070'];

/** The colour a catalogue layer shows: its own, or one of a palette by position. */
export function catalogLayerColour(layers: readonly CatalogTypeLayer[], index: number): string {
  return layers[index]?.color ?? PALETTE[index % PALETTE.length];
}

interface PsetRead { setId: number; idProp: number | null; specProp: number | null; id: string | null; spec: unknown }

function readPset(reader: AnchorEntityReader, typeId: number): PsetRead | null {
  const type = reader.entity(typeId);
  const sets = type?.attributes[HAS_PROPERTY_SETS];
  for (const ref of Array.isArray(sets) ? sets : []) {
    const setId = refId(ref);
    const set = setId === null ? null : reader.entity(setId);
    if (!set || set.type.toUpperCase() !== 'IFCPROPERTYSET' || set.attributes[2] !== CATALOG_TYPE_PSET) continue;
    const out: PsetRead = { setId: setId!, idProp: null, specProp: null, id: null, spec: null };
    for (const p of Array.isArray(set.attributes[4]) ? set.attributes[4] : []) {
      const pid = refId(p);
      const prop = pid === null ? null : reader.entity(pid);
      const value = nominal(prop?.attributes[2]);
      if (prop?.attributes[0] === 'Id' && typeof value === 'string') { out.idProp = pid; out.id = value; }
      if (prop?.attributes[0] === 'Spec' && typeof value === 'string') {
        out.specProp = pid;
        try { out.spec = JSON.parse(value); } catch { out.spec = null; }
      }
    }
    return out;
  }
  return null;
}

/** The layer set a type carries (IfcRelAssociatesMaterial → IfcMaterialLayerSet), or null. */
function typeLayerSet(store: IfcDataStore, reader: AnchorEntityReader, typeId: number, view?: MutablePropertyView | null): { relId: number; setId: number } | null {
  for (const rel of readRelatedLists(store, 'IfcRelAssociatesMaterial', view)) {
    if (!rel.relatedIds.includes(typeId) || rel.relatingId === undefined) continue;
    if (reader.entity(rel.relatingId)?.type.toUpperCase() === 'IFCMATERIALLAYERSET') return { relId: rel.relId, setId: rel.relatingId };
  }
  return null;
}

/** A type object's catalogue entry, or null when it is not one. */
export function readCatalogType(store: IfcDataStore, typeId: number, view?: MutablePropertyView | null): CatalogTypeInModel | null {
  const reader = new AnchorEntityReader(store, view);
  const pset = readPset(reader, typeId);
  if (!pset?.id) return null;
  return { id: pset.id, typeId, layerSetId: typeLayerSet(store, reader, typeId, view)?.setId ?? null, spec: pset.spec };
}

/** The type in the model written for catalogue entry `id`, or null. */
export function findCatalogTypeInStore(store: IfcDataStore, id: string, ifcClass: string, view?: MutablePropertyView | null): CatalogTypeInModel | null {
  const reader = new AnchorEntityReader(store, view);
  for (const typeId of reader.ids(ifcClass.toUpperCase())) {
    const read = readCatalogType(store, typeId, view);
    if (read?.id === id) return read;
  }
  return null;
}

/** The catalogue type an element is typed by, or null. */
export function catalogTypeOfElement(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): CatalogTypeInModel | null {
  const rel = readRelatedLists(store, 'IfcRelDefinesByType', view).find((r) => r.relatedIds.includes(elementId));
  return rel?.relatingId !== undefined ? readCatalogType(store, rel.relatingId, view) : null;
}

function emitPset(editor: StoreEditor, anchor: CatalogAnchor, input: CatalogTypeInput): number {
  const id = editor.addEntity('IfcPropertySingleValue', ['Id', null, { typed: { type: 'IfcIdentifier', value: input.id } }, null]).expressId;
  const spec = editor.addEntity('IfcPropertySingleValue', ['Spec', null, { typed: { type: 'IfcText', value: JSON.stringify(input.spec) } }, null]).expressId;
  return editor.addEntity('IfcPropertySet', [generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), CATALOG_TYPE_PSET, null, [`#${id}`, `#${spec}`]]).expressId;
}

function emitLayerSet(editor: StoreEditor, anchor: CatalogAnchor, input: CatalogTypeInput): number {
  const layers = input.layers ?? [];
  const materials = layers.map((l, i) => {
    const materialId = addMaterialToStore(editor, anchor, { Name: l.name }).materialId;
    colourMaterial(editor, anchor, materialId, catalogLayerColour(layers, i), l.name);
    return materialId;
  });
  return addMaterialLayerSetToStore(editor, anchor, {
    LayerSetName: input.name,
    MaterialLayers: layers.map((l, i) => ({ Material: materials[i], LayerThickness: l.thickness, Name: l.name })),
  }).layerSetId;
}

function associate(editor: StoreEditor, anchor: CatalogAnchor, materialId: number, ids: readonly number[]): number {
  return editor.addEntity('IfcRelAssociatesMaterial', [
    generateIfcGuid(anchor.guidRandom), ownerHistoryRef(anchor.ownerHistoryId), null, null, ids.map((id) => `#${id}`), `#${materialId}`,
  ]).expressId;
}

/** The entry's type in the model: found by its id, else written (with its property set and layer set). */
export function ensureCatalogTypeInStore(store: IfcDataStore, editor: StoreEditor, anchor: CatalogAnchor, input: CatalogTypeInput): CatalogTypeInModel {
  const found = findCatalogTypeInStore(store, input.id, input.ifcClass, editor.getMutationView());
  if (found) return found;
  const { typeId } = addElementTypeToStore(editor, anchor, { Type: input.ifcClass, Name: input.name, Tag: input.mark });
  editor.setPositionalAttribute(typeId, HAS_PROPERTY_SETS, [`#${emitPset(editor, anchor, input)}`]);
  let layerSetId: number | null = null;
  if (input.layers?.length) {
    layerSetId = emitLayerSet(editor, anchor, input);
    associate(editor, anchor, layerSetId, [typeId]);
  }
  return { id: input.id, typeId, layerSetId, spec: input.spec };
}

/** Drop a layer set this module wrote, with its layers, materials and their colours, once nothing uses it. */
function dropLayerSet(store: IfcDataStore, editor: StoreEditor, setId: number): void {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const layers = (reader.entity(setId)?.attributes[0] as unknown[] | undefined ?? []).map(refId).filter((id): id is number => id !== null);
  const materials = new Set(layers.map((l) => refId(reader.entity(l)?.attributes[0])).filter((id): id is number => id !== null));
  const appearances = [...reader.ids('IFCMATERIALDEFINITIONREPRESENTATION')].filter((id) => materials.has(refId(reader.entity(id)?.attributes[3]) ?? -1));
  // A material another set still layers keeps its colour.
  const stillUsed = new Set<number>();
  for (const layer of reader.ids('IFCMATERIALLAYER')) {
    if (layers.includes(layer)) continue;
    const m = refId(reader.entity(layer)?.attributes[0]);
    if (m !== null) stillUsed.add(m);
  }
  pruneOrphanOverlay(editor, appearances.filter((id) => !stillUsed.has(refId(reader.entity(id)?.attributes[3]) ?? -1)));
  pruneOrphanOverlay(editor, [setId]);
}

/**
 * Follow a changed catalogue entry. Returns the type's (new) layer set and
 * the IfcMaterialLayerSetUsage records now pointing to it.
 */
export function rewriteCatalogTypeInStore(store: IfcDataStore, editor: StoreEditor, anchor: CatalogAnchor, found: CatalogTypeInModel, input: CatalogTypeInput): { layerSetId: number | null; usages: number[] } {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  editor.setPositionalAttribute(found.typeId, NAME, input.name);
  editor.setPositionalAttribute(found.typeId, TAG, input.mark ?? null);
  const pset = readPset(reader, found.typeId);
  if (pset?.specProp != null) editor.setPositionalAttribute(pset.specProp, 2, { typed: { type: 'IfcText', value: JSON.stringify(input.spec) } } as Attr);
  const old = typeLayerSet(store, reader, found.typeId, view);
  if (!input.layers?.length) return { layerSetId: old?.setId ?? null, usages: [] };
  const layerSetId = emitLayerSet(editor, anchor, input);
  if (old) editor.setPositionalAttribute(old.relId, 5, `#${layerSetId}`);
  else associate(editor, anchor, layerSetId, [found.typeId]);
  const usages: number[] = [];
  if (old) {
    for (const usage of [...reader.ids('IFCMATERIALLAYERSETUSAGE')]) {
      if (refId(reader.entity(usage)?.attributes[0]) !== old.setId) continue;
      editor.setPositionalAttribute(usage, 0, `#${layerSetId}`);
      usages.push(usage);
    }
    dropLayerSet(store, editor, old.setId);
  }
  return { layerSetId, usages };
}

/** Set an occurrence usage's offset from its reference line (metres): a wall's layers centred on its axis start at −total / 2. */
export function setLayerUsageOffset(editor: StoreEditor, anchor: Pick<SpatialAnchor, 'lengthUnitScale'>, usageId: number, offset: number): void {
  editor.setPositionalAttribute(usageId, 3, { real: toNativeLength(anchor, offset) } as Attr);
}
