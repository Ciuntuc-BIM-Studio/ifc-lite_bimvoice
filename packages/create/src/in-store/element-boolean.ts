/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Boolean operations between elements (Lapin's Studio tab).
 *
 * - SUBTRACT is live, like ArchiCAD's solid element operations: an
 *   IfcRelInterferesElements with ImpliedOrder TRUE (the RelatedElement, the
 *   tool, is taken out of the RelatingElement, the target — the geometry
 *   engine applies it as a void), named so the cut-priority sync leaves it
 *   alone. Both elements stay as they are and stay editable; the cut follows
 *   them. Removing the relation takes the subtraction back.
 * - UNION and INTERSECTION are baked: the target's body becomes an
 *   IfcBooleanResult of its own solid and the tools' solids, carried into
 *   its frame; the caller then deletes the tools.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { getModelLengthUnitScale } from './edit/length-unit-scale.js';
import { axis3d, refId, type Frame3, type Vec3 } from './host-geometry-frame.js';
import { compose, invert, worldFrame, type Frame3D } from './placement-3d.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { canonicalEntity, schemaAttributes, schemaRegistry } from './schema-attributes.js';

/** The Name of a live subtraction (the cut-priority sync only touches its own, 'IfcLite cut'). */
export const SUBTRACT_NAME = 'Lapin subtract';

type Anchor = Pick<SpatialAnchor, 'ownerHistoryId' | 'guidRandom' | 'schema'>;
type Attr = Parameters<StoreEditor['addEntity']>[1];

export interface Subtraction {
  relId: number;
  target: number;
  tool: number;
}

/** The live subtractions of the model (those touching `ids`, when given). */
export function readSubtractions(store: IfcDataStore, view?: MutablePropertyView | null, ids?: ReadonlySet<number>): Subtraction[] {
  const r = new AnchorEntityReader(store, view);
  const out: Subtraction[] = [];
  for (const relId of r.ids('IFCRELINTERFERESELEMENTS')) {
    const rel = r.entity(relId);
    if (!rel || rel.attributes[2] !== SUBTRACT_NAME) continue;
    const target = refId(rel.attributes[4]), tool = refId(rel.attributes[5]);
    if (target === null || tool === null) continue;
    if (ids && !ids.has(target) && !ids.has(tool)) continue;
    out.push({ relId, target, tool });
  }
  return out;
}

/** Take `tools` out of `target`, live. Returns the elements to re-mesh. */
export function subtractElementsInStore(store: IfcDataStore, editor: StoreEditor, anchor: Anchor, target: number, tools: readonly number[]): number[] {
  const op = 'subtractElementsInStore';
  const registry = schemaRegistry(anchor.schema, op);
  const relClass = canonicalEntity(registry, 'IfcRelInterferesElements');
  if (!relClass) throw new Error(`${op}: ${anchor.schema ?? 'IFC4'} has no IfcRelInterferesElements`);
  const existing = new Set(readSubtractions(store, editor.getMutationView(), new Set([target])).map((s) => `${s.target}:${s.tool}`));
  const added: number[] = [];
  for (const tool of tools) {
    if (tool === target || existing.has(`${target}:${tool}`)) continue;
    const attrs = schemaAttributes(registry, relClass, {
      GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: SUBTRACT_NAME,
      RelatingElement: `#${target}`, RelatedElement: `#${tool}`, InterferenceType: 'Subtract', ImpliedOrder: true,
    }, op);
    editor.addEntity(relClass, attrs as Attr);
    added.push(tool);
  }
  return added.length ? [target, ...added] : [];
}

/** Take back every live subtraction `ids` take part in (as target or tool). Returns the elements to re-mesh. */
export function removeSubtractionsInStore(store: IfcDataStore, editor: StoreEditor, ids: readonly number[]): number[] {
  const remesh = new Set<number>();
  for (const s of readSubtractions(store, editor.getMutationView(), new Set(ids))) {
    editor.removeEntity(s.relId);
    remesh.add(s.target);
    remesh.add(s.tool);
  }
  return [...remesh];
}

// ---------------------------------------------------------------- baked

type BakedOp = 'UNION' | 'INTERSECTION';

interface Body { repId: number; items: number[] }

function bodyOf(r: AnchorEntityReader, id: number): Body | null {
  const shape = r.entity(refId(r.entity(id)?.attributes[6]) ?? -1);
  if (shape?.type.toUpperCase() !== 'IFCPRODUCTDEFINITIONSHAPE' || !Array.isArray(shape.attributes[2])) return null;
  const reps = (shape.attributes[2] as unknown[]).map(refId).filter((x): x is number => x !== null);
  const repId = reps.find((x) => r.entity(x)?.attributes[1] === 'Body') ?? reps[0];
  const rep = repId === undefined ? null : r.entity(repId);
  const items = Array.isArray(rep?.attributes[3]) ? (rep!.attributes[3] as unknown[]).map(refId).filter((x): x is number => x !== null) : [];
  return repId !== undefined && items.length ? { repId, items } : null;
}

const mul = (f: Frame3D, p: readonly number[]): Vec3 => [
  f.r[0][0] * p[0] + f.r[0][1] * p[1] + f.r[0][2] * p[2] + f.t[0],
  f.r[1][0] * p[0] + f.r[1][1] * p[1] + f.r[1][2] * p[2] + f.t[1],
  f.r[2][0] * p[0] + f.r[2][1] * p[1] + f.r[2][2] * p[2] + f.t[2],
];
const turn = (f: Frame3D, d: readonly number[]): Vec3 => [
  f.r[0][0] * d[0] + f.r[0][1] * d[1] + f.r[0][2] * d[2],
  f.r[1][0] * d[0] + f.r[1][1] * d[1] + f.r[1][2] * d[2],
  f.r[2][0] * d[0] + f.r[2][1] * d[1] + f.r[2][2] * d[2],
];

const SWEPT = new Set(['IFCEXTRUDEDAREASOLID', 'IFCEXTRUDEDAREASOLIDTAPERED', 'IFCREVOLVEDAREASOLID', 'IFCREVOLVEDAREASOLIDTAPERED', 'IFCFIXEDREFERENCESWEPTAREASOLID', 'IFCSURFACECURVESWEPTAREASOLID']);
const BOOLEANS = new Set(['IFCBOOLEANRESULT', 'IFCBOOLEANCLIPPINGRESULT']);

/**
 * A copy of the solid `id` carried by `f` (native units): a swept solid gets
 * a moved Position, a faceted brep moved points, a boolean result its
 * operands carried. Null for what cannot be carried (a mapped item, a half
 * space bounded by a plane in another frame…).
 */
function carried(r: AnchorEntityReader, editor: StoreEditor, id: number, f: Frame3D): number | null {
  const e = r.entity(id);
  const type = e?.type.toUpperCase();
  if (!e || !type) return null;
  const point = (p: Vec3) => `#${editor.addEntity('IfcCartesianPoint', [[...p]] as Attr).expressId}`;
  const direction = (d: Vec3) => `#${editor.addEntity('IfcDirection', [[...d]] as Attr).expressId}`;
  const placement = (frame: Frame3) => `#${editor.addEntity('IfcAxis2Placement3D', [point(mul(f, frame.o)), direction(turn(f, frame.z)), direction(turn(f, frame.x))] as Attr).expressId}`;
  if (SWEPT.has(type)) {
    const frame = axis3d(r, e.attributes[1]);
    if (!frame) return null;
    const attrs = [...e.attributes] as unknown[];
    attrs[1] = placement(frame);
    return editor.addEntity(e.type, attrs as Attr).expressId;
  }
  if (type === 'IFCFACETEDBREP') {
    const shell = r.entity(refId(e.attributes[0]) ?? -1);
    const faces = Array.isArray(shell?.attributes[0]) ? (shell!.attributes[0] as unknown[]) : [];
    const points = new Map<number, string>();
    const moved = (pid: number) => {
      let ref = points.get(pid);
      if (!ref) {
        const c = r.entity(pid)?.attributes[0];
        if (!Array.isArray(c)) throw new Error(`#${pid} is not a point`);
        ref = point(mul(f, [Number(c[0]), Number(c[1]), Number(c[2] ?? 0)]));
        points.set(pid, ref);
      }
      return ref;
    };
    const newFaces = faces.map((faceRef) => {
      const face = r.entity(refId(faceRef) ?? -1);
      const bounds = Array.isArray(face?.attributes[0]) ? (face!.attributes[0] as unknown[]) : [];
      const newBounds = bounds.map((boundRef) => {
        const bound = r.entity(refId(boundRef) ?? -1)!;
        const loop = r.entity(refId(bound.attributes[0]) ?? -1)!;
        const pts = (loop.attributes[0] as unknown[]).map((p) => moved(refId(p)!));
        const newLoop = editor.addEntity('IfcPolyLoop', [pts] as Attr).expressId;
        return `#${editor.addEntity(bound.type, [`#${newLoop}`, bound.attributes[1]] as Attr).expressId}`;
      });
      return `#${editor.addEntity('IfcFace', [newBounds] as Attr).expressId}`;
    });
    const newShell = editor.addEntity('IfcClosedShell', [newFaces] as Attr).expressId;
    return editor.addEntity('IfcFacetedBrep', [`#${newShell}`] as Attr).expressId;
  }
  if (BOOLEANS.has(type)) {
    const a = carried(r, editor, refId(e.attributes[1]) ?? -1, f);
    const b = carried(r, editor, refId(e.attributes[2]) ?? -1, f);
    return a === null || b === null ? null : editor.addEntity(e.type, [e.attributes[0], `#${a}`, `#${b}`] as Attr).expressId;
  }
  return null;
}

/** `ids` folded into one operand by `op` (one id: itself). */
function fold(editor: StoreEditor, ids: readonly number[], op: BakedOp | 'UNION'): number {
  return ids.slice(1).reduce((acc, id) => editor.addEntity('IfcBooleanResult', [`.${op}.`, `#${acc}`, `#${id}`] as Attr).expressId, ids[0]);
}

export type BakeOutcome = { ok: true; remesh: number[] } | { ok: false; reason: string };

/**
 * The target's body becomes its solid united with (UNION) or cut down to
 * (INTERSECTION) the tools' solids. The tools are left in place: the caller
 * deletes them in the same step.
 */
export function bakeBooleanInStore(store: IfcDataStore, editor: StoreEditor, target: number, tools: readonly number[], op: BakedOp): BakeOutcome {
  const view = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  const scale = getModelLengthUnitScale(store);
  const frameOf = (id: number): Frame3D | null => {
    const placement = refId(r.entity(id)?.attributes[5]);
    const f = placement === null ? null : worldFrame({ dataStore: store, view }, placement);
    // Native units: the world frames are in metres.
    return f ? { r: f.r, t: [f.t[0] / scale, f.t[1] / scale, f.t[2] / scale] } : null;
  };
  const body = bodyOf(r, target);
  const targetFrame = frameOf(target);
  if (!body || !targetFrame) return { ok: false, reason: `#${target} has no body to combine` };
  const toTarget = invert(targetFrame);
  const operands: number[] = [];
  for (const tool of tools) {
    const b = bodyOf(r, tool);
    const f = frameOf(tool);
    if (!b || !f) return { ok: false, reason: `#${tool} has no body to combine` };
    const carry = compose(toTarget, f);
    for (const item of b.items) {
      const moved = carried(r, editor, item, carry);
      if (moved === null) return { ok: false, reason: `#${tool}'s body (${r.entity(item)?.type}) cannot be combined` };
      operands.push(moved);
    }
  }
  if (operands.length === 0) return { ok: false, reason: 'No tool to combine' };
  const own = fold(editor, body.items, 'UNION');
  const result = editor.addEntity('IfcBooleanResult', [`.${op}.`, `#${own}`, `#${fold(editor, operands, 'UNION')}`] as Attr).expressId;
  editor.setPositionalAttribute(body.repId, 2, 'CSG');
  editor.setPositionalAttribute(body.repId, 3, [`#${result}`] as Attr[number]);
  return { ok: true, remesh: [target] };
}
