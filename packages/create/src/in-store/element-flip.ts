/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Flipping an element in place along one of its own two plan directions:
 * X mirrors it across the plane through its centre normal to its local X
 * (left ↔ right), Y across the plane normal to its local Y (front ↔ back).
 *
 * - A wall flips across its axis only (Y): the body's profile is mirrored
 *   across the axis (an offset body goes to the other side) and its
 *   IfcMaterialLayerSetUsage turns (DirectionSense, OffsetFromReferenceLine),
 *   so the layers swap faces. The body stays a plain extrusion, editable as
 *   before. A wall body of another kind is mirrored like any element.
 * - Any other element keeps its body and is shown through an IfcMappedItem
 *   whose operator mirrors it about its centre: the body becomes the map's
 *   representation the first time, later flips compose into the operator,
 *   and when the operator is back to identity the wrapper goes. IFC wants a
 *   positive Scale, so the mirror is a left-handed operator basis (Axis1 /
 *   Axis2 / Axis3 explicit), as door and window flips are written.
 * - Doors and windows with a configured type flip through their type's
 *   mapped body (`setJoineryFlipsInStore`): X the hand, Y the swing side.
 *
 * Coordinates are the file's native length units throughout (the mirror
 * reads and writes the same records), so no unit conversion is involved.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from './resolve-anchor.js';
import { axis2d, axis3d, refId, type Frame3, type Vec3 } from './host-geometry-frame.js';
import { curvePoints, numeric, operatorFrame, repCentre, upper } from './element-geometry-points.js';
import { readJoineryFlips } from './joinery-read.js';
import { setJoineryFlipsInStore } from './joinery-sync.js';
import { pruneOrphanOverlay } from './overlay-prune.js';

type Attr = Parameters<StoreEditor['addEntity']>[1][number];
type Reader = AnchorEntityReader;

export type FlipAxis = 'x' | 'y';
export type FlipOutcome = { ok: true; remesh: number[] } | { ok: false; reason: string };

const WALLS = new Set(['IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCWALLELEMENTEDCASE']);
const NOT_FLIPPABLE = new Set(['IFCOPENINGELEMENT', 'IFCROOF', 'IFCBUILDINGSTOREY', 'IFCBUILDING', 'IFCSITE', 'IFCPROJECT', 'IFCGRID', 'IFCANNOTATION']);

const ref = (id: number) => `#${id}`;
// ---------------------------------------------------------------- body

interface Body { shapeId: number; reps: (string | null)[]; index: number; repId: number }

function bodyOf(r: Reader, elementId: number): Body | null {
  const element = r.entity(elementId);
  const shapeId = refId(element?.attributes[6]);
  const shape = shapeId === null ? null : r.entity(shapeId);
  const ids = Array.isArray(shape?.attributes[2]) ? shape.attributes[2].map(refId) : [];
  // Parsed references read as numbers, overlay ones as '#id': written back as '#id'.
  const reps = ids.map((id) => (id === null ? null : ref(id)));
  let index = ids.findIndex((id) => id !== null && r.entity(id)?.attributes[1] === 'Body');
  if (index < 0) index = ids.findIndex((id) => id !== null && !['Axis', 'FootPrint', 'Box', 'Annotation'].includes(String(r.entity(id)?.attributes[1])));
  if (shapeId === null || index < 0) return null;
  return { shapeId, reps, index, repId: ids[index]! };
}

/** Point the element at a new product shape whose body is `repId`; the old shape goes when unused. */
function replaceBody(editor: StoreEditor, r: Reader, elementId: number, body: Body, repId: number): void {
  const shape = r.entity(body.shapeId)!;
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  const reps = body.reps.map((v, i) => (i === body.index ? ref(repId) : v)).filter((v): v is string => v !== null);
  const shapeId = editor.addEntity('IfcProductDefinitionShape', [text(shape.attributes[0]), text(shape.attributes[1]), reps]).expressId;
  editor.setPositionalAttribute(elementId, 6, ref(shapeId));
  pruneOrphanOverlay(editor, [body.shapeId]);
}

const direction = (editor: StoreEditor, v: Vec3) => ref(editor.addEntity('IfcDirection', [v.map((c) => Math.round(c * 1e12) / 1e12)]).expressId);
const point = (editor: StoreEditor, v: Vec3) => ref(editor.addEntity('IfcCartesianPoint', [v]).expressId);

const isIdentity = (f: Frame3) => {
  const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  return near(f.o, [0, 0, 0]) && near(f.x, [1, 0, 0]) && near(f.y, [0, 1, 0]) && near(f.z, [0, 0, 1]);
};

/** Mirror the element's body about its centre: `sx`, `sy` are −1 on the flipped axis. */
function mirrorBody(editor: StoreEditor, r: Reader, elementId: number, body: Body, sx: number, sy: number, centre?: [number, number]): void {
  const [cx, cy] = centre ?? repCentre(r, body.repId);
  const S = (v: Vec3): Vec3 => [v[0] * sx, v[1] * sy, v[2]];
  const shift: Vec3 = [(1 - sx) * cx, (1 - sy) * cy, 0];
  const rep = r.entity(body.repId)!;
  const contextId = refId(rep.attributes[0]);
  const context = contextId === null ? null : ref(contextId);
  const items = Array.isArray(rep.attributes[3]) ? rep.attributes[3].map(refId) : [];
  const mapped = rep.attributes[2] === 'MappedRepresentation' && items.length > 0 && items.every((id) => id !== null && upper(r.entity(id)) === 'IFCMAPPEDITEM');
  const emitItem = (mapId: number, f: Frame3, opType = 'IfcCartesianTransformationOperator3D') => {
    // Axes carry the scale of a uniform operator; read it back off the first axis.
    const scale = Math.hypot(...f.x) || 1;
    const unitOf = (v: Vec3) => v.map((c) => c / (Math.hypot(...v) || 1)) as Vec3;
    const nonUniform = opType.toUpperCase() === 'IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM';
    const attrs: Attr[] = [direction(editor, unitOf(f.x)), direction(editor, unitOf(f.y)), point(editor, f.o), Math.abs(scale - 1) < 1e-12 ? null : { real: scale }, direction(editor, unitOf(f.z))];
    if (nonUniform) attrs.push({ real: Math.hypot(...f.y) }, { real: Math.hypot(...f.z) });
    const op = editor.addEntity(nonUniform ? 'IfcCartesianTransformationOperator3DnonUniform' : 'IfcCartesianTransformationOperator3D', attrs).expressId;
    return editor.addEntity('IfcMappedItem', [ref(mapId), ref(op)]).expressId;
  };
  if (mapped) {
    const next: { mapId: number; frame: Frame3; type: string }[] = items.map((id) => {
      const item = r.entity(id!)!;
      const opId = refId(item.attributes[1]);
      const f = operatorFrame(r, opId) ?? { o: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
      const o = S(f.o);
      return { mapId: refId(item.attributes[0])!, frame: { o: [o[0] + shift[0], o[1] + shift[1], o[2]], x: S(f.x), y: S(f.y), z: S(f.z) }, type: upper(r.entity(opId ?? -1)) || 'IFCCARTESIANTRANSFORMATIONOPERATOR3D' };
    });
    // Back to where it started: an overlay wrapper this module made unwraps.
    if (next.length === 1 && isIdentity(next[0].frame)) {
      const map = editor.getNewEntity(next[0].mapId);
      const original = map ? refId(map.attributes[1]) : null;
      const origin = map ? axis3d(r, map.attributes[0]) : null;
      if (original !== null && origin && isIdentity(origin)) {
        replaceBody(editor, r, elementId, body, original);
        pruneOrphanOverlay(editor, [next[0].mapId]);
        return;
      }
    }
    const newItems = next.map((n) => ref(emitItem(n.mapId, n.frame, n.type === 'IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM' ? 'IfcCartesianTransformationOperator3DnonUniform' : undefined)));
    const repId = editor.addEntity('IfcShapeRepresentation', [context, 'Body', 'MappedRepresentation', newItems]).expressId;
    replaceBody(editor, r, elementId, body, repId);
    return;
  }
  const origin = editor.addEntity('IfcAxis2Placement3D', [point(editor, [0, 0, 0]), null, null]).expressId;
  const mapId = editor.addEntity('IfcRepresentationMap', [ref(origin), ref(body.repId)]).expressId;
  const item = emitItem(mapId, { o: shift, x: [sx, 0, 0], y: [0, sy, 0], z: [0, 0, 1] });
  const repId = editor.addEntity('IfcShapeRepresentation', [context, 'Body', 'MappedRepresentation', [ref(item)]]).expressId;
  replaceBody(editor, r, elementId, body, repId);
}

// ---------------------------------------------------------------- walls

/** Mirror a plain wall body across its axis (y → −y) by rewriting its profile; false when the body is not a plain extrusion. */
function mirrorWallProfile(editor: StoreEditor, r: Reader, body: Body): boolean {
  const rep = r.entity(body.repId);
  const items = Array.isArray(rep?.attributes[3]) ? rep.attributes[3] : [];
  if (items.length !== 1) return false;
  const solid = r.entity(refId(items[0]) ?? -1);
  if (upper(solid) !== 'IFCEXTRUDEDAREASOLID') return false;
  const frame = axis3d(r, solid!.attributes[1]);
  // The solid must sit in the wall's own plan frame (only a vertical offset allowed).
  if (!frame || Math.abs(frame.o[0]) > 1e-9 || Math.abs(frame.o[1]) > 1e-9 || Math.abs(frame.z[2] - 1) > 1e-9 || Math.abs(frame.x[0] - 1) > 1e-9) return false;
  const profileId = refId(solid!.attributes[0]);
  const profile = profileId === null ? null : r.entity(profileId);
  const type = upper(profile);
  if (type === 'IFCRECTANGLEPROFILEDEF') {
    const f = axis2d(r, profile!.attributes[2]);
    if (!f) return false;
    const location = editor.addEntity('IfcCartesianPoint', [[f.o[0], -f.o[1]]]).expressId;
    const dir = editor.addEntity('IfcDirection', [[f.x[0], -f.x[1]]]).expressId;
    const placement = editor.addEntity('IfcAxis2Placement2D', [ref(location), ref(dir)]).expressId;
    editor.setPositionalAttribute(profileId!, 2, ref(placement));
    return true;
  }
  if (type === 'IFCARBITRARYCLOSEDPROFILEDEF' && upper(r.entity(refId(profile!.attributes[2]) ?? -1)) === 'IFCPOLYLINE') {
    // Mirrored and reversed, so the loop keeps its winding.
    const pts = curvePoints(r, refId(profile!.attributes[2])).map(([x, y]) => [x, -y] as [number, number]).reverse();
    const ids = pts.map((p) => ref(editor.addEntity('IfcCartesianPoint', [p]).expressId));
    const polyline = editor.addEntity('IfcPolyline', [ids]).expressId;
    editor.setPositionalAttribute(profileId!, 2, ref(polyline));
    return true;
  }
  return false;
}

/** Turn the wall's layer-set usage: the layers run from the other face. A usage shared with other walls is split off first. */
function flipLayerUsage(editor: StoreEditor, r: Reader, wallId: number): void {
  for (const relId of [...r.ids('IFCRELASSOCIATESMATERIAL')]) {
    const rel = r.entity(relId);
    const related = Array.isArray(rel?.attributes[4]) ? rel.attributes[4] : [];
    if (!rel || !related.some((v) => refId(v) === wallId)) continue;
    const usageId = refId(rel.attributes[5]);
    const usage = usageId === null ? null : r.entity(usageId);
    if (upper(usage) !== 'IFCMATERIALLAYERSETUSAGE') continue;
    const sense = usage!.attributes[2] === '.NEGATIVE.' || usage!.attributes[2] === 'NEGATIVE' ? '.POSITIVE.' : '.NEGATIVE.';
    const offset = { real: -(numeric(usage!.attributes[3]) ?? 0) };
    if (related.length === 1) {
      editor.setPositionalAttribute(usageId!, 2, sense);
      editor.setPositionalAttribute(usageId!, 3, offset);
      continue;
    }
    const en = (v: unknown) => (typeof v === 'string' ? (v.startsWith('.') ? v : `.${v}.`) : null);
    const forSet = refId(usage!.attributes[0]);
    const extentValue = numeric(usage!.attributes[4]);
    const extent = extentValue === null ? null : { real: extentValue };
    const own = editor.addEntity('IfcMaterialLayerSetUsage', [forSet === null ? null : ref(forSet), en(usage!.attributes[1]), sense, offset, ...(usage!.attributes.length > 4 ? [extent] : [])]).expressId;
    editor.setPositionalAttribute(relId, 4, related.map(refId).filter((id): id is number => id !== null && id !== wallId).map(ref));
    const owner = refId(rel.attributes[1]);
    editor.addEntity('IfcRelAssociatesMaterial', [generateIfcGuid(), owner === null ? null : ref(owner), null, null, [ref(wallId)], ref(own)]);
  }
}

// ---------------------------------------------------------------- entry

/** Flip `elementId` along its own `axis`. The caller owns the atomic commit. */
export function flipElementInStore(store: IfcDataStore, editor: StoreEditor, elementId: number, axis: FlipAxis): FlipOutcome {
  const view = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  const element = r.entity(elementId);
  const type = upper(element);
  if (!element) return { ok: false, reason: `#${elementId} is not in the model` };
  if (NOT_FLIPPABLE.has(type)) return { ok: false, reason: `${element.type} cannot be flipped` };
  if (type.startsWith('IFCDOOR') || type.startsWith('IFCWINDOW')) {
    const bit = axis === 'x' ? 1 : 2;
    if (setJoineryFlipsInStore(store, editor, elementId, readJoineryFlips(store, elementId, view) ^ bit)) return { ok: true, remesh: [elementId] };
    return { ok: false, reason: 'untyped-joinery' };
  }
  const body = bodyOf(r, elementId);
  if (!body) return { ok: false, reason: `${element.type} #${elementId} has no body to flip` };
  if (WALLS.has(type)) {
    if (axis === 'x') return { ok: false, reason: 'A wall flips across its axis (Flip Y): its ends stay where they are' };
    if (!mirrorWallProfile(editor, r, body)) mirrorBody(editor, r, elementId, body, 1, -1, [0, 0]);
    flipLayerUsage(editor, r, elementId);
    return { ok: true, remesh: [elementId] };
  }
  mirrorBody(editor, r, elementId, body, axis === 'x' ? -1 : 1, axis === 'y' ? -1 : 1);
  return { ok: true, remesh: [elementId] };
}
