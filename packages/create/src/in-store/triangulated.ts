/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * An element whose body is an IfcTriangulatedFaceSet (IFC4 and IFC4X3): a
 * terrain, a corridor's pavement course (closed) or its cut and fill slopes
 * (open). One IfcCartesianPointList3D and one index list, however many
 * triangles — far lighter than a faceted B-rep of the same mesh. The
 * triangles are read back by `readTriangulatedBody` (what the corridor
 * daylights to), in storey-local metres.
 */

import type { StoreEditor } from '@ifc-lite/mutations';
import { emitLocalPlacement, emitRelContainedInSpatialStructure, emitSurfaceStyle, ownerHistoryRef, productGuid } from './_emit-helpers.js';
import { fromNativeLength, toNativePoint3, type SpatialAnchor } from './anchor.js';
import { numeric } from './element-geometry-points.js';
import { applyFrame, placementInAncestor, refId } from './host-geometry-frame.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import type { AnchorEntityReader } from './resolve-anchor.js';
import { canonicalEntity, conformsTo, schemaAttributes, schemaRegistry } from './schema-attributes.js';

type Vec3 = [number, number, number];
type Attr = Parameters<StoreEditor['addEntity']>[1];

export interface TriangulatedInStoreParams {
  IfcClass: string;
  PredefinedType?: string;
  Name?: string;
  Description?: string;
  ObjectType?: string;
  Tag?: string;
  GlobalId?: string;
  /** Storey-local metres. */
  Points: readonly Vec3[];
  /** Indices into `Points`, counter-clockwise seen from outside / above. */
  Triangles: readonly (readonly [number, number, number])[];
  /** A closed shell (a solid) or an open surface. */
  Closed: boolean;
  /** CSS hex colour for a surface style; none when absent. */
  Color?: string;
  /** 0 … 1; 1 when absent. */
  Alpha?: number;
}

export interface TriangulatedBuildResult {
  elementId: number;
  placementId: number;
  productShapeId: number;
  globalId: string;
  ifcClass: string;
}

const rgb = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { red: parseInt(m[1], 16) / 255, green: parseInt(m[2], 16) / 255, blue: parseInt(m[3], 16) / 255 } : { red: 0.5, green: 0.5, blue: 0.5 };
};

function validate(p: TriangulatedInStoreParams, op: string): void {
  if (p.Points.length < 3) throw new Error(`${op}: a face set needs at least three points`);
  if (p.Triangles.length === 0) throw new Error(`${op}: a face set needs at least one triangle`);
  for (const pt of p.Points) if (!pt.every(Number.isFinite)) throw new Error(`${op}: a point is not finite`);
  for (const t of p.Triangles) for (const i of t) if (!(i >= 0 && i < p.Points.length)) throw new Error(`${op}: triangle index ${i} out of range`);
}

function emitGeometry(editor: StoreEditor, anchor: SpatialAnchor, p: TriangulatedInStoreParams): { placementId: number; productShapeId: number } {
  const placementId = emitLocalPlacement(editor, anchor.storeyPlacementId, [0, 0, 0]);
  const coords = editor.addEntity('IfcCartesianPointList3D', [p.Points.map((pt) => toNativePoint3(anchor, pt).map((v) => ({ real: v })))] as Attr).expressId;
  const faceSet = editor.addEntity('IfcTriangulatedFaceSet', [`#${coords}`, null, p.Closed ? '.T.' : '.F.', p.Triangles.map((t) => [t[0] + 1, t[1] + 1, t[2] + 1]), null] as Attr).expressId;
  if (p.Color) {
    const style = emitSurfaceStyle(editor, anchor.schema ?? 'IFC4', { ...rgb(p.Color), alpha: p.Alpha ?? 1 }, p.Name).styleRefId;
    editor.addEntity('IfcStyledItem', [`#${faceSet}`, [`#${style}`], null]);
  }
  const shapeRepId = editor.addEntity('IfcShapeRepresentation', [`#${anchor.bodyContextId}`, 'Body', 'Tessellation', [`#${faceSet}`]]).expressId;
  const productShapeId = editor.addEntity('IfcProductDefinitionShape', [null, null, [`#${shapeRepId}`]]).expressId;
  return { placementId, productShapeId };
}

export function addTriangulatedElementToStore(editor: StoreEditor, anchor: SpatialAnchor, p: TriangulatedInStoreParams): TriangulatedBuildResult {
  const op = 'addTriangulatedElementToStore';
  validate(p, op);
  if ((anchor.schema ?? 'IFC4') === 'IFC2X3') throw new Error(`${op}: IfcTriangulatedFaceSet needs IFC4 or IFC4X3`);
  const registry = schemaRegistry(anchor.schema, op);
  const ifcClass = canonicalEntity(registry, p.IfcClass);
  if (!ifcClass || !conformsTo(registry, ifcClass, 'IfcProduct')) throw new Error(`${op}: "${p.IfcClass}" is not a product class in ${anchor.schema ?? 'IFC4'}`);
  const { placementId, productShapeId } = emitGeometry(editor, anchor, p);
  const globalId = productGuid(p, anchor.guidRandom);
  const names = registry.entities[ifcClass].allAttributes?.map((a) => a.name) ?? [];
  const values: Record<string, unknown> = {
    GlobalId: globalId, OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: p.Name ?? ifcClass.replace(/^Ifc/, ''), Description: p.Description ?? null,
    ObjectType: p.ObjectType ?? null, ObjectPlacement: `#${placementId}`, Representation: `#${productShapeId}`,
  };
  if (names.includes('Tag')) values.Tag = p.Tag ?? null;
  if (p.PredefinedType && names.includes('PredefinedType')) values.PredefinedType = p.PredefinedType;
  const elementId = editor.addEntity(ifcClass, schemaAttributes(registry, ifcClass, values, op) as Attr).expressId;
  emitRelContainedInSpatialStructure(editor, anchor.ownerHistoryId, elementId, anchor.storeyId, anchor.guidRandom);
  return { elementId, placementId, productShapeId, globalId, ifcClass };
}

/** New body for an existing element (same expressId and GlobalId); the old records pruned. */
export function replaceTriangulatedGeometryInStore(editor: StoreEditor, anchor: SpatialAnchor, elementId: number, p: TriangulatedInStoreParams): { placementId: number; productShapeId: number } {
  const old = elementGeometryRefs(editor, elementId);
  const made = rewriteTriangulatedGeometry(editor, anchor, elementId, p);
  pruneOrphanOverlay(editor, old);
  return made;
}

/** As `replaceTriangulatedGeometryInStore`, leaving the old records for the caller to prune. */
export function rewriteTriangulatedGeometry(editor: StoreEditor, anchor: SpatialAnchor, elementId: number, p: TriangulatedInStoreParams): { placementId: number; productShapeId: number } {
  validate(p, 'replaceTriangulatedGeometryInStore');
  const { placementId, productShapeId } = emitGeometry(editor, anchor, p);
  editor.setPositionalAttribute(elementId, 5, `#${placementId}`);
  editor.setPositionalAttribute(elementId, 6, `#${productShapeId}`);
  return { placementId, productShapeId };
}

export interface TriangulatedBody {
  points: Vec3[];
  triangles: [number, number, number][];
}

/**
 * The triangles of an element's IfcTriangulatedFaceSet bodies, in the frame
 * of `ancestorPlacementId` (the storey's placement; null for the model's),
 * metres; null when the element has no such body.
 */
export function readTriangulatedBody(r: AnchorEntityReader, anchor: Pick<SpatialAnchor, 'lengthUnitScale'>, elementId: number, ancestorPlacementId: number | null): TriangulatedBody | null {
  const element = r.entity(elementId);
  if (!element) return null;
  const placementId = refId(element.attributes[5]);
  const world = placementId === null ? null : placementInAncestor(r, placementId, null);
  const ancestor = ancestorPlacementId === null ? null : placementInAncestor(r, ancestorPlacementId, null);
  // Into the ancestor's frame: its axes are orthonormal, so the inverse is a projection.
  const toAncestor = (p: Vec3): Vec3 => {
    if (!ancestor) return p;
    const d: Vec3 = [p[0] - ancestor.o[0], p[1] - ancestor.o[1], p[2] - ancestor.o[2]];
    const dot = (a: Vec3) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
    return [dot(ancestor.x), dot(ancestor.y), dot(ancestor.z)];
  };
  const shape = r.entity(refId(element.attributes[6]) ?? -1);
  const points: Vec3[] = [];
  const triangles: [number, number, number][] = [];
  for (const repRef of Array.isArray(shape?.attributes[2]) ? shape.attributes[2] : []) {
    const rep = r.entity(refId(repRef) ?? -1);
    for (const itemRef of Array.isArray(rep?.attributes[3]) ? rep.attributes[3] : []) {
      const item = r.entity(refId(itemRef) ?? -1);
      if (!item || item.type.toUpperCase() !== 'IFCTRIANGULATEDFACESET') continue;
      const list = r.entity(refId(item.attributes[0]) ?? -1);
      const coords = Array.isArray(list?.attributes[0]) ? list.attributes[0] : [];
      const base = points.length;
      for (const c of coords) {
        const v = Array.isArray(c) ? c.map((x) => numeric(x) ?? 0) : [0, 0, 0];
        const local: Vec3 = [fromNativeLength(anchor, v[0] ?? 0), fromNativeLength(anchor, v[1] ?? 0), fromNativeLength(anchor, v[2] ?? 0)];
        points.push(toAncestor(world ? applyFrame(world, local) : local));
      }
      for (const t of Array.isArray(item.attributes[3]) ? item.attributes[3] : []) {
        if (!Array.isArray(t) || t.length < 3) continue;
        const idx = t.map((x) => (numeric(x) ?? 0) - 1 + base);
        if (idx.every((k) => k >= base && k < points.length)) triangles.push([idx[0], idx[1], idx[2]]);
      }
    }
  }
  return points.length ? { points, triangles } : null;
}
