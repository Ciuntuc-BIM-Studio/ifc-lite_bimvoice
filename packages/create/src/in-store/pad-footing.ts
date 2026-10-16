/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A stepped pad footing in a model: one IfcFooting PAD_FOOTING whose body
 * is a stack of boxes (an IfcExtrudedAreaSolid per step, bottom step
 * first), centred on its placement, in concrete, typed by the catalogue
 * entry's IfcFootingType. Its spec (`PadFootingSpec`) is kept on it as
 * Pset_LapinPadFooting.
 *
 * `regeneratePadFootingInStore` gives it a changed spec's steps in place
 * (same entity and GlobalId), where it stands now: a moved or turned
 * footing keeps its place and direction.
 */

import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { toNativeLength, type SpatialAnchor } from './anchor.js';
import { emitLocalPlacement, emitRectangleProfile, emitRelContainedInSpatialStructure, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { readElementPlacement } from './element-relocate.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { padFootingProblems, type PadFootingSpec, type PadFootingType } from './foundation-spec.js';
import {
  assignFoundationMaterial, foundationMaterialInStore, readSpecPset, storedSpec, typeFoundationParts, updateSpecPset, writeSpecPset,
} from './foundation-shared.js';

type Attr = Parameters<StoreEditor['addEntity']>[1];

export const PAD_FOOTING_PSET = 'Pset_LapinPadFooting';

export interface PadFootingResult {
  footingId: number;
  globalId: string;
}

function typeOf(spec: PadFootingSpec): PadFootingType {
  const { typeId, name, steps, bottom, concrete } = spec;
  return { typeId, name, steps, bottom, concrete };
}

function check(spec: PadFootingSpec): void {
  const problems = padFootingProblems(spec);
  if (problems.length) throw new Error(`Pad footing: ${problems.join('; ')}`);
  if (![spec.position[0], spec.position[1], spec.rotation].every(Number.isFinite)) throw new Error('Pad footing: its place must be finite');
}

/** Placement (the footing's centre at its underside, turned by its rotation) and the stepped body. */
function emitGeometry(editor: StoreEditor, anchor: SpatialAnchor, spec: PadFootingSpec): { placementId: number; productShapeId: number } {
  const n = (v: number) => toNativeLength(anchor, v);
  const placementId = emitLocalPlacement(
    editor, anchor.storeyPlacementId, [n(spec.position[0]), n(spec.position[1]), n(spec.bottom)],
    [0, 0, 1], [Math.cos(spec.rotation), Math.sin(spec.rotation), 0],
  );
  const up = editor.addEntity('IfcDirection', [[0, 0, 1]] as Attr).expressId;
  let z = 0;
  const solids = spec.steps.map((step) => {
    const profileId = emitRectangleProfile(editor, n(step.length), n(step.width));
    const origin = editor.addEntity('IfcCartesianPoint', [[0, 0, n(z)]] as Attr).expressId;
    const position = editor.addEntity('IfcAxis2Placement3D', [`#${origin}`, null, null] as Attr).expressId;
    z += step.height;
    return editor.addEntity('IfcExtrudedAreaSolid', [`#${profileId}`, `#${position}`, `#${up}`, n(step.height)] as Attr).expressId;
  });
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', 'SweptSolid', solids.map((s) => `#${s}`)] as Attr).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${shapeRepId}`]] as Attr).expressId;
  return { placementId, productShapeId };
}

function finish(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: PadFootingSpec, footingId: number): void {
  typeFoundationParts(store, editor, anchor, { id: spec.typeId, ifcClass: 'IfcFootingType', name: spec.name, spec: storedSpec(typeOf(spec)) }, [footingId]);
  assignFoundationMaterial(store, editor, anchor, foundationMaterialInStore(store, editor, anchor, spec.concrete), [footingId]);
}

/** Write a stepped pad footing, its type, concrete and spec. */
export function addPadFootingToStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, spec: PadFootingSpec, params: { GlobalId?: string } = {}): PadFootingResult {
  check(spec);
  const { placementId, productShapeId } = emitGeometry(editor, anchor, spec);
  const globalId = productGuid(params, anchor.guidRandom);
  // IfcFooting: … ObjectPlacement, Representation, Tag, PredefinedType.
  const footingId = editor.addEntity('IfcFooting', [
    globalId, ownerHistoryRef(anchor.ownerHistoryId), 'Pad footing', null, spec.name, `#${placementId}`, `#${productShapeId}`, null, '.PAD_FOOTING.',
  ] as Attr).expressId;
  emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, footingId, anchor.storeyId, anchor.guidRandom);
  finish(store, editor, anchor, spec, footingId);
  writeSpecPset(editor, anchor, footingId, PAD_FOOTING_PSET, spec);
  return { footingId, globalId };
}

/** The spec a pad footing keeps, or null when `id` is not one. */
export function readPadFooting(store: IfcDataStore, id: number, view?: MutablePropertyView | null): PadFootingSpec | null {
  const reader = new AnchorEntityReader(store, view);
  if (reader.entity(id)?.type.toUpperCase() !== 'IFCFOOTING') return null;
  return readSpecPset<PadFootingSpec>(reader, id, PAD_FOOTING_PSET)?.spec ?? null;
}

/** Its spec with where it stands now (moved or turned since). */
export function readPlacedPadFooting(store: IfcDataStore, editor: Pick<StoreEditor, 'getMutationView'>, anchor: Pick<SpatialAnchor, 'lengthUnitScale'>, id: number): PadFootingSpec | null {
  const spec = readPadFooting(store, id, editor.getMutationView());
  if (!spec) return null;
  const at = readElementPlacement(store, editor, id);
  if (!at) return spec;
  const metre = toNativeLength(anchor, 1);
  return { ...spec, position: [at.x / metre, at.y / metre, 0], rotation: (at.rz * Math.PI) / 180 };
}

/** Give pad footing `id` the steps and level of `input`, where it stands now, keeping its entity and GlobalId. */
export function regeneratePadFootingInStore(store: IfcDataStore, editor: StoreEditor, anchor: SpatialAnchor, id: number, input: PadFootingSpec): PadFootingResult {
  const view = editor.getMutationView();
  const reader = new AnchorEntityReader(store, view);
  const kept = readSpecPset<PadFootingSpec>(reader, id, PAD_FOOTING_PSET);
  if (!kept || reader.entity(id)?.type.toUpperCase() !== 'IFCFOOTING') throw new Error(`#${id} is not a pad footing`);
  const placed = readPlacedPadFooting(store, editor, anchor, id) ?? kept.spec;
  const spec: PadFootingSpec = { ...input, position: placed.position, rotation: placed.rotation };
  check(spec);
  const old = elementGeometryRefs(editor, id);
  const { placementId, productShapeId } = emitGeometry(editor, anchor, spec);
  editor.setPositionalAttribute(id, 5, `#${placementId}`);
  editor.setPositionalAttribute(id, 6, `#${productShapeId}`);
  editor.setPositionalAttribute(id, 4, spec.name);
  pruneOrphanOverlay(editor, old);
  finish(store, editor, anchor, spec, id);
  updateSpecPset(editor, kept.propertyId, spec);
  const globalId = reader.entity(id)?.attributes[0];
  return { footingId: id, globalId: typeof globalId === 'string' ? globalId : '' };
}
