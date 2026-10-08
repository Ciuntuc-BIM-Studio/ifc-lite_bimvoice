/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A generic faceted element in a loaded model: any IfcElement class whose
 * body is an IfcFacetedBrep (a closed shell of planar polygon faces), placed
 * in its storey — what a pitched roof, or any solid no extrusion describes,
 * is written as. IfcFacetedBrep exists in IFC2X3, IFC4 and IFC4X3 alike.
 *
 * `replaceFacetedGeometryInStore` points the SAME element at a new placement
 * and body, keeping its expressId, GlobalId, relationships and properties.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { emitLocalPlacement, emitRelContainedInSpatialStructure, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { toNativePoint3, type SpatialAnchor } from './anchor.js';
import { canonicalEntity, conformsTo, schemaAttributes, schemaRegistry } from './schema-attributes.js';

type Vec3 = [number, number, number];

export interface FacetedInStoreParams {
  /** Any IfcElement subtype, e.g. 'IfcRoof', 'IfcBuildingElementProxy'. */
  IfcClass: string;
  PredefinedType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  GlobalId?: string;
  /** The closed shell's faces: planar loops, counter-clockwise seen from outside, metres in the placement's frame. */
  Faces: Vec3[][];
  /** Placement origin, storey-local metres (axes are the storey's). */
  Location: Vec3;
}

export interface FacetedBuildResult {
  elementId: number;
  placementId: number;
  productShapeId: number;
  relContainedId: number;
  globalId: string;
  ifcClass: string;
}

function validate(params: FacetedInStoreParams, op: string): void {
  if (params.Faces.length < 4) throw new Error(`${op}: a closed shell needs at least 4 faces`);
  for (const face of params.Faces) {
    if (face.length < 3) throw new Error(`${op}: every face needs at least 3 points`);
    if (face.some((p) => !p.every(Number.isFinite))) throw new Error(`${op}: a face has a non-finite point`);
  }
}

function emitGeometry(editor: StoreEditor, anchor: SpatialAnchor, params: FacetedInStoreParams): { placementId: number; productShapeId: number } {
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, toNativePoint3(anchor, params.Location));
  // One point per distinct vertex, shared by the faces that meet there.
  const points = new Map<string, string>();
  const point = (p: Vec3): string => {
    const native = toNativePoint3(anchor, p);
    const k = native.map((v) => v.toFixed(9)).join(',');
    let ref = points.get(k);
    if (!ref) points.set(k, (ref = `#${editor.addEntity('IfcCartesianPoint', [native]).expressId}`));
    return ref;
  };
  const faces = params.Faces.map((loop) => {
    const polyLoop = editor.addEntity('IfcPolyLoop', [loop.map(point)]).expressId;
    const bound = editor.addEntity('IfcFaceOuterBound', [`#${polyLoop}`, '.T.']).expressId;
    return `#${editor.addEntity('IfcFace', [[`#${bound}`]]).expressId}`;
  });
  const shell = editor.addEntity('IfcClosedShell', [faces]).expressId;
  const brep = editor.addEntity('IfcFacetedBrep', [`#${shell}`]).expressId;
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', 'Brep', [`#${brep}`]]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${shapeRepId}`]]).expressId;
  return { placementId, productShapeId };
}

export function addFacetedElementToStore(editor: StoreEditor, anchor: SpatialAnchor, params: FacetedInStoreParams): FacetedBuildResult {
  const op = 'addFacetedElementToStore';
  validate(params, op);
  const registry = schemaRegistry(anchor.schema, op);
  const ifcClass = canonicalEntity(registry, params.IfcClass);
  if (!ifcClass || !conformsTo(registry, ifcClass, 'IfcElement')) {
    throw new Error(`${op}: "${params.IfcClass}" is not an IfcElement class in ${anchor.schema ?? 'IFC4'}`);
  }
  const { placementId, productShapeId } = emitGeometry(editor, anchor, params);
  const globalId = productGuid(params, anchor.guidRandom);
  const values: Record<string, unknown> = {
    GlobalId: globalId,
    OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId),
    Name: params.Name ?? ifcClass.replace(/^Ifc/, ''),
    Description: params.Description ?? null,
    ObjectType: params.ObjectType ?? null,
    ObjectPlacement: `#${placementId}`,
    Representation: `#${productShapeId}`,
    Tag: params.Tag ?? null,
  };
  const attributeNames = registry.entities[ifcClass].allAttributes?.map((a) => a.name) ?? [];
  if (params.PredefinedType && attributeNames.includes('PredefinedType')) values.PredefinedType = params.PredefinedType;
  // IFC2X3 IfcRoof carries ShapeType instead.
  if (params.PredefinedType && attributeNames.includes('ShapeType') && !attributeNames.includes('PredefinedType')) values.ShapeType = params.PredefinedType;
  const elementId = editor.addEntity(ifcClass, schemaAttributes(registry, ifcClass, values, op) as Parameters<StoreEditor['addEntity']>[1]).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, elementId, anchor.storeyId, anchor.guidRandom);
  return { elementId, placementId, productShapeId, relContainedId, globalId, ifcClass };
}

/** New placement and body for an existing element (same expressId and GlobalId); ObjectPlacement (5) and Representation (6). */
export function replaceFacetedGeometryInStore(editor: StoreEditor, anchor: SpatialAnchor, elementId: number, params: FacetedInStoreParams): { placementId: number; productShapeId: number } {
  validate(params, 'replaceFacetedGeometryInStore');
  const { placementId, productShapeId } = emitGeometry(editor, anchor, params);
  editor.setPositionalAttribute(elementId, 5, `#${placementId}`);
  editor.setPositionalAttribute(elementId, 6, `#${productShapeId}`);
  return { placementId, productShapeId };
}
