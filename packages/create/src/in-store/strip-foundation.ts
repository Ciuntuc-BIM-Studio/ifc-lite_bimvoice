/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A strip foundation in a model: an IfcElementAssembly aggregating the
 * foundation wall (an IfcWall, tag `stem`, layered through an
 * IfcMaterialLayerSetUsage with its core on the axis) and the strip footing
 * under it (an IfcFooting STRIP_FOOTING, tag `footing`, in concrete). Its
 * spec (`StripFoundationSpec`) is kept on the assembly as
 * Pset_LapinStripFoundation; the stem and the footing are typed by the
 * catalogue entry's IfcWallType and IfcFootingType.
 *
 * The stem is an ordinary wall to the wall tools: it joins other stems at a
 * corner like walls do. `regenerateStripFoundationInStore` follows a changed
 * spec in place (the parts keep their GlobalIds) where the stem stands now,
 * keeping its joins.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { generateIfcGuid } from '@ifc-lite/encoding';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import { emitLocalPlacement, emitRelContainedInSpatialStructure, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { setLayerUsageOffset, type CatalogTypeInput } from './catalog-type.js';
import { addExtrusionToStore, replaceExtrusionGeometryInStore, type ExtrusionInStoreParams } from './extrusion.js';
import { addMaterialLayerSetUsageToStore, assignMaterialInStore } from './material.js';
import { readRelatedLists } from './resolve-relations.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { addWallToStore, type WallInStoreParams } from './wall.js';
import { reshapeWallsInStore, resolveWallJoinAnchor } from './wall-join-edit.js';
import { readWallJoinTarget } from './wall-join-read.js';
import { stemSection, stripFootingRun, stripFoundationProblems, type StripFoundationSpec, type StripFoundationType } from './foundation-spec.js';
import {
  assignFoundationMaterial, foundationMaterialInStore, readSpecPset, refId, storedSpec, typeFoundationParts, updateSpecPset, writeSpecPset,
} from './foundation-shared.js';

type Attr = Parameters<StoreEditor['addEntity']>[1];
type Vec3 = [number, number, number];

export const STRIP_FOUNDATION_PSET = 'Pset_LapinStripFoundation';
const OBJECT_TYPE = 'Strip foundation';

export interface StripFoundationResult {
  foundationId: number;
  stemId: number;
  footingId: number;
  /** Elements whose geometry was written (to re-mesh): the parts, and walls re-cut at the stem's joins. */
  remesh: number[];
}

/** The catalogue entry's own fields (what its IFC types keep). */
function typeOf(spec: StripFoundationSpec): StripFoundationType {
  const { typeId, name, layers, stemHeight, footingWidth, footingHeight, bottom, concrete } = spec;
  return { typeId, name, layers, stemHeight, footingWidth, footingHeight, bottom, concrete };
}

function stemTypeInput(spec: StripFoundationSpec): CatalogTypeInput {
  return {
    id: `${spec.typeId}:stem`, ifcClass: 'IfcWallType', name: `${spec.name} (wall)`,
    layers: spec.layers.map(({ name, thickness, color, appearance }) => ({ name, thickness, color, ...(appearance ? { appearance } : {}) })),
    spec: storedSpec(typeOf(spec)),
  };
}

function footingTypeInput(spec: StripFoundationSpec): CatalogTypeInput {
  return { id: `${spec.typeId}:footing`, ifcClass: 'IfcFootingType', name: `${spec.name} (footing)`, spec: storedSpec(typeOf(spec)) };
}

function axisOf(spec: StripFoundationSpec): { length: number; u: [number, number] } {
  const dx = spec.end[0] - spec.start[0], dy = spec.end[1] - spec.start[1];
  const length = Math.hypot(dx, dy);
  return { length, u: [dx / length, dy / length] };
}

function stemParams(spec: StripFoundationSpec): WallInStoreParams {
  const { thickness, bodyOffset } = stemSection(spec.layers);
  const z = spec.bottom + spec.footingHeight;
  return {
    Start: [spec.start[0], spec.start[1], z], End: [spec.end[0], spec.end[1], z],
    Thickness: thickness, Height: spec.stemHeight, Offset: bodyOffset,
    Name: 'Foundation wall', ObjectType: spec.name, Tag: 'stem',
  };
}

function footingParams(spec: StripFoundationSpec): ExtrusionInStoreParams {
  const { u } = axisOf(spec);
  const { length, before } = stripFootingRun(spec);
  const w = spec.footingWidth / 2;
  return {
    IfcClass: 'IfcFooting', PredefinedType: 'STRIP_FOOTING', Name: 'Strip footing', ObjectType: spec.name, Tag: 'footing',
    Outer: [[-before, -w], [length - before, -w], [length - before, w], [-before, w]],
    Depth: spec.footingHeight, Location: [spec.start[0], spec.start[1], spec.bottom], RefDirection: [u[0], u[1], 0],
  };
}

function check(spec: StripFoundationSpec): void {
  const problems = stripFoundationProblems(spec);
  if (problems.length) throw new Error(`Strip foundation: ${problems.join('; ')}`);
  if (!(axisOf(spec).length > 1e-6)) throw new Error('Strip foundation: its ends must be apart');
}

/** The stem's layer usage, current: typed, its layer set, the core on the axis. */
function layerStem(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: StripFoundationSpec, stemId: number): void {
  const { layerSetId } = typeFoundationParts(store, editor, anchor, stemTypeInput(spec), [stemId]);
  if (layerSetId === null) return;
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const rels = readRelatedLists(store, 'IfcRelAssociatesMaterial', view);
  const usage = rels.find((r) => r.relatedIds.includes(stemId) && r.relatingId !== undefined && reader.entity(r.relatingId)?.type.toUpperCase() === 'IFCMATERIALLAYERSETUSAGE')?.relatingId;
  const { layerOffset } = stemSection(spec.layers);
  if (usage !== undefined) {
    editor.setPositionalAttribute(usage, 0, `#${layerSetId}`);
    setLayerUsageOffset(editor, anchor, usage, layerOffset);
    return;
  }
  const made = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: layerSetId, LayerSetDirection: 'AXIS2', OffsetFromReferenceLine: layerOffset }).usageId;
  assignMaterialInStore(editor, anchor, made, [stemId], rels);
}

function finishFooting(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: StripFoundationSpec, footingId: number): void {
  typeFoundationParts(store, editor, anchor, footingTypeInput(spec), [footingId]);
  assignFoundationMaterial(store, editor, anchor, foundationMaterialInStore(store, editor, anchor, spec.concrete), [footingId]);
}

/** Write a strip foundation: the assembly, its stem and footing, their types and materials, its spec. */
export function addStripFoundationToStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: StripFoundationSpec, params: { GlobalId?: string } = {}): StripFoundationResult {
  check(spec);
  const owner = ownerHistoryRef(anchor.ownerHistoryId);
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, [0, 0, 0]);
  const foundationId = editor.addEntity('IfcElementAssembly', [
    productGuid(params, anchor.guidRandom), owner, spec.name, null, OBJECT_TYPE, `#${placementId}`, null, null, '.SITE.', '.USERDEFINED.',
  ] as Attr).expressId;
  emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, foundationId, anchor.storeyId, anchor.guidRandom);

  const stem = addWallToStore(editor, anchor, stemParams(spec));
  const footing = addExtrusionToStore(editor, anchor, footingParams(spec));
  // Parts belong to the foundation (aggregated), not to the storey directly.
  editor.removeEntity(stem.relContainedId);
  editor.removeEntity(footing.relContainedId);
  editor.addEntity('IfcRelAggregates', [generateIfcGuid(anchor.guidRandom), owner, null, null, `#${foundationId}`, [`#${stem.wallId}`, `#${footing.elementId}`]] as Attr);

  layerStem(store, editor, anchor, spec, stem.wallId);
  finishFooting(store, editor, anchor, spec, footing.elementId);
  writeSpecPset(editor, anchor, foundationId, STRIP_FOUNDATION_PSET, spec);
  return { foundationId, stemId: stem.wallId, footingId: footing.elementId, remesh: [stem.wallId, footing.elementId] };
}

interface StripRead {
  spec: StripFoundationSpec;
  propertyId: number;
  stemId: number | null;
  footingId: number | null;
}

function readRecord(store: IfcDataStore, id: number, view?: MutablePropertyView | null): StripRead | null {
  const reader = new AnchorEntityReader(store, view);
  if (reader.entity(id)?.type.toUpperCase() !== 'IFCELEMENTASSEMBLY') return null;
  const found = readSpecPset<StripFoundationSpec>(reader, id, STRIP_FOUNDATION_PSET);
  if (!found) return null;
  const out: StripRead = { ...found, stemId: null, footingId: null };
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    if (!rel || refId(rel.attributes[4]) !== id) continue;
    for (const r of Array.isArray(rel.attributes[5]) ? rel.attributes[5] : []) {
      const part = refId(r);
      const tag = part === null ? null : reader.entity(part)?.attributes[7];
      if (tag === 'stem') out.stemId = part;
      if (tag === 'footing') out.footingId = part;
    }
  }
  return out;
}

/** The spec a strip foundation keeps, or null when `id` is not one. */
export function readStripFoundation(store: IfcDataStore, id: number, view?: MutablePropertyView | null): StripFoundationSpec | null {
  return readRecord(store, id, view)?.spec ?? null;
}

/** Its stem and footing. */
export function stripFoundationParts(store: IfcDataStore, id: number, view?: MutablePropertyView | null): number[] {
  const read = readRecord(store, id, view);
  return read ? [read.stemId, read.footingId].filter((p): p is number => p !== null) : [];
}

/** The strip foundation an element is (or is a part of), or null. */
export function stripFoundationOf(store: IfcDataStore, elementId: number, view?: MutablePropertyView | null): number | null {
  if (readRecord(store, elementId, view)) return elementId;
  const reader = new AnchorEntityReader(store, view);
  for (const relId of reader.ids('IFCRELAGGREGATES')) {
    const rel = reader.entity(relId);
    const parts = rel?.attributes[5];
    if (!Array.isArray(parts) || !parts.some((r) => refId(r) === elementId)) continue;
    const whole = refId(rel!.attributes[4]);
    if (whole !== null && readRecord(store, whole, view)) return whole;
  }
  return null;
}

/** The spec of strip foundation `id` with its axis where the stem stands now (moved, turned, joined). */
export function readPlacedStripFoundation(store: IfcDataStore, view: MutablePropertyView | null | undefined, id: number, lengthUnitScale: number): StripFoundationSpec | null {
  const read = readRecord(store, id, view);
  if (!read) return null;
  const stem = read.stemId === null ? null : readWallJoinTarget(store, view, read.stemId, lengthUnitScale);
  if (!stem) return read.spec;
  const at = (p: readonly number[]): Vec3 => [p[0], p[1], read.spec.start[2] ?? 0];
  return { ...read.spec, start: at(stem.wall.start), end: at(stem.wall.end) };
}

/**
 * Rebuild strip foundation `id` to `input` (its type fields; the axis is
 * where the stem stands now), in place: the stem takes the new section and
 * heights and keeps its joins, the footing takes its new size.
 */
export function regenerateStripFoundationInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, id: number, input: StripFoundationSpec): StripFoundationResult {
  const view = editor.getMutationView();
  const scale = anchor.lengthUnitScale ?? 1;
  const current = readRecord(store, id, view);
  if (!current || current.stemId === null || current.footingId === null) throw new Error(`#${id} is not a strip foundation`);
  const placed = readPlacedStripFoundation(store, view, id, scale) ?? current.spec;
  const spec: StripFoundationSpec = { ...input, start: placed.start, end: placed.end };
  check(spec);

  const { thickness, bodyOffset } = stemSection(spec.layers);
  const reshaped = reshapeWallsInStore(editor, store, resolveWallJoinAnchor(store, view), [{ wallId: current.stemId, thickness, offset: bodyOffset }]);
  // Its foot and height: the placement's z and the extrusion depth.
  const stem = readWallJoinTarget(store, editor.getMutationView(), current.stemId, scale);
  if (stem) {
    const z = toNativeLength(anchor, spec.bottom + spec.footingHeight);
    const point = editor.addEntity('IfcCartesianPoint', [[stem.location[0], stem.location[1], z]] as Attr).expressId;
    editor.setPositionalAttribute(stem.axisPlacementId, 0, `#${point}`);
    editor.setPositionalAttribute(stem.solidId, 3, { real: toNativeLength(anchor, spec.stemHeight) } as Attr[number]);
  }
  editor.setPositionalAttribute(current.stemId, 4, spec.name);
  layerStem(store, editor, anchor, spec, current.stemId);

  replaceExtrusionGeometryInStore(editor, anchor, current.footingId, footingParams(spec));
  editor.setPositionalAttribute(current.footingId, 4, spec.name);
  finishFooting(store, editor, anchor, spec, current.footingId);

  updateSpecPset(editor, current.propertyId, spec);
  editor.setPositionalAttribute(id, 2, spec.name);
  return { foundationId: id, stemId: current.stemId, footingId: current.footingId, remesh: [...new Set([...reshaped.walls, current.stemId, current.footingId])] };
}
