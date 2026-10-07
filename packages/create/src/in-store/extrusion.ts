/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A generic extruded element in a loaded model: any IfcElement class, an
 * arbitrary closed profile with optional voids, a placement oriented any
 * way (its local Z is the extrusion direction), contained in a storey.
 * This is how a closed contour drawn on any work plane becomes a model
 * element.
 *
 * Attributes are laid out by name from the schema registry
 * (`schemaAttributes`), so IFC2X3 / IFC4 / IFC4X3 differences — an
 * IfcBuildingElementProxy's CompositionType vs PredefinedType, an IFC4
 * IfcFurnishingElement with no PredefinedType — come out right.
 *
 * `replaceExtrusionGeometryInStore` rebuilds the placement, profile and
 * solid and points the SAME element at them: its expressId, GlobalId,
 * relationships and property sets survive an edit of its base contour.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import {
  emitBodyRepresentation, emitExtrudedSolid, emitLocalPlacement, emitPolygonProfile, emitRelContainedInSpatialStructure,
  ownerHistoryRef, productGuid,
} from './_emit-helpers.js';
import { toNativeLength, toNativePoint2, toNativePoint3, type SpatialAnchor } from './anchor.js';
import { canonicalEntity, conformsTo, schemaAttributes, schemaRegistry } from './schema-attributes.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

export interface ExtrusionInStoreParams {
  /** Any IfcElement subtype, e.g. 'IfcBuildingElementProxy', 'IfcWall', 'IfcSlab'. */
  IfcClass: string;
  PredefinedType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  GlobalId?: string;
  /** Outer boundary in the placement's XY plane, metres (closed automatically). */
  Outer: Vec2[];
  /** Holes, same frame. */
  Holes?: Vec2[][];
  /** Extrusion length along the placement's local +Z, metres (> 0). */
  Depth: number;
  /** Placement origin, storey-local metres. */
  Location: Vec3;
  /** Placement Z (extrusion direction) and X, storey-local unit vectors. Default: world Z / X. */
  Axis?: Vec3;
  RefDirection?: Vec3;
}

export interface ExtrusionBuildResult {
  elementId: number;
  placementId: number;
  productShapeId: number;
  relContainedId: number;
  globalId: string;
  ifcClass: string;
}

function emitProfile(editor: StoreEditor, anchor: SpatialAnchor, outer: Vec2[], holes: Vec2[][]): number {
  const native = (curve: Vec2[]) => curve.map((p) => toNativePoint2(anchor, p));
  if (holes.length === 0) return emitPolygonProfile(editor, native(outer));
  const polyline = (curve: Vec2[]) => {
    const pts = native(curve);
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9;
    const ids = (closed ? pts : [...pts, first]).map((p) => `#${editor.addEntity('IfcCartesianPoint', [[p[0], p[1]]]).expressId}`);
    return `#${editor.addEntity('IfcPolyline', [ids]).expressId}`;
  };
  return editor.addEntity('IfcArbitraryProfileDefWithVoids', ['.AREA.', null, polyline(outer), holes.map(polyline)]).expressId;
}

function validate(params: ExtrusionInStoreParams, op: string): void {
  if (params.Outer.length < 3) throw new Error(`${op}: the outer boundary needs at least 3 points`);
  if (params.Holes?.some((h) => h.length < 3)) throw new Error(`${op}: every hole needs at least 3 points`);
  if (!(params.Depth > 0) || !Number.isFinite(params.Depth)) throw new Error(`${op}: Depth must be a positive length`);
}

/** Placement, profile, solid and body representation — the element's geometry. */
function emitGeometry(editor: StoreEditor, anchor: SpatialAnchor, params: ExtrusionInStoreParams): { placementId: number; productShapeId: number } {
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, toNativePoint3(anchor, params.Location), params.Axis, params.RefDirection);
  const profileId = emitProfile(editor, anchor, params.Outer, params.Holes ?? []);
  const solidId = emitExtrudedSolid(editor, profileId, toNativeLength(anchor, params.Depth));
  const { productShapeId } = emitBodyRepresentation(editor, anchor.bodyContextId, solidId);
  return { placementId, productShapeId };
}

export function addExtrusionToStore(editor: StoreEditor, anchor: SpatialAnchor, params: ExtrusionInStoreParams): ExtrusionBuildResult {
  const op = 'addExtrusionToStore';
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
  const elementId = editor.addEntity(ifcClass, schemaAttributes(registry, ifcClass, values, op) as Parameters<StoreEditor['addEntity']>[1]).expressId;
  const relContainedId = emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, elementId, anchor.storeyId, anchor.guidRandom);
  return { elementId, placementId, productShapeId, relContainedId, globalId, ifcClass };
}

/**
 * New placement and geometry for an existing element (same expressId and
 * GlobalId). The previous placement / shape chain is left unreferenced, as
 * the other in-store edits do. Positional indices are IfcProduct's
 * ObjectPlacement (5) and Representation (6), identical in every schema.
 */
export function replaceExtrusionGeometryInStore(editor: StoreEditor, anchor: SpatialAnchor, elementId: number, params: ExtrusionInStoreParams): void {
  validate(params, 'replaceExtrusionGeometryInStore');
  const { placementId, productShapeId } = emitGeometry(editor, anchor, params);
  editor.setPositionalAttribute(elementId, 5, `#${placementId}`);
  editor.setPositionalAttribute(elementId, 6, `#${productShapeId}`);
}
