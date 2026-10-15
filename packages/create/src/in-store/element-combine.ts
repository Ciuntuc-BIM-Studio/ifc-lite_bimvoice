/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Live Union and Intersect (Lapin's Studio tab), like the live Subtract:
 * the tools stay elements of their own, still editable, and the target's
 * body is its own solid combined with their bodies as they are now.
 *
 * Each tool is tied to the target by an IfcRelInterferesElements named
 * `Lapin union` / `Lapin intersect` (the target is the RelatingElement),
 * ImpliedOrder FALSE so nothing reads it as a cut (TRUE subtracts the tool).
 * The target's body is one IfcBooleanResult per tie, in tie order, over its
 * own body (`rebakeCombinationInStore`): rebuilt whenever the target or a
 * tool changes shape, it strips the results it wrote last time (one per tie)
 * and writes them again from the tools' current bodies. Separating takes the
 * ties away and leaves the target its own body again.
 */

import { generateIfcGuid } from '@ifc-lite/encoding';
import type { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { SpatialAnchor } from './anchor.js';
import { ownerHistoryRef } from './_emit-helpers.js';
import { combinationOf } from './body-trim.js';
import { bodyOf, carried, fold, nativeFrameOf, type BakeOutcome } from './element-boolean.js';
import { refId } from './host-geometry-frame.js';
import { compose, invert } from './placement-3d.js';
import { AnchorEntityReader } from './resolve-anchor.js';
import { canonicalEntity, schemaAttributes, schemaRegistry } from './schema-attributes.js';

export type CombineOp = 'UNION' | 'INTERSECTION';
const NAMES: Readonly<Record<CombineOp, string>> = { UNION: 'Lapin union', INTERSECTION: 'Lapin intersect' };
const OP_OF = new Map<unknown, CombineOp>([[NAMES.UNION, 'UNION'], [NAMES.INTERSECTION, 'INTERSECTION']]);

type Anchor = Pick<SpatialAnchor, 'ownerHistoryId' | 'guidRandom' | 'schema'>;
type Attr = Parameters<StoreEditor['addEntity']>[1];

export interface Combination {
  relId: number;
  target: number;
  tool: number;
  op: CombineOp;
}

/** The live combinations of the model (those touching `ids`, when given), in tie order. */
export function readCombinations(store: IfcDataStore, view?: MutablePropertyView | null, ids?: ReadonlySet<number>): Combination[] {
  const r = new AnchorEntityReader(store, view);
  const out: Combination[] = [];
  for (const relId of r.ids('IFCRELINTERFERESELEMENTS')) {
    const rel = r.entity(relId);
    const op = OP_OF.get(rel?.attributes[2]);
    if (!rel || !op) continue;
    const target = refId(rel.attributes[4]), tool = refId(rel.attributes[5]);
    if (target === null || tool === null) continue;
    if (ids && !ids.has(target) && !ids.has(tool)) continue;
    out.push({ relId, target, tool, op });
  }
  return out.sort((a, b) => a.relId - b.relId);
}

/** The representation type a single body item is written with. */
function representationType(type: string | undefined): string {
  switch (type?.toUpperCase()) {
    case 'IFCFACETEDBREP': return 'Brep';
    case 'IFCBOOLEANCLIPPINGRESULT': return 'Clipping';
    case 'IFCBOOLEANRESULT': return 'CSG';
    case 'IFCEXTRUDEDAREASOLID': case 'IFCREVOLVEDAREASOLID': case 'IFCSWEPTDISKSOLID': return 'SweptSolid';
    default: return 'SolidModel';
  }
}

/**
 * Write `target`'s body again: its own body (the `strip` results the last
 * rebuild wrote taken off) combined with each tie's tool as it is now.
 * `strip` defaults to the target's ties (what the last rebuild wrote).
 */
export function rebakeCombinationInStore(store: IfcDataStore, editor: StoreEditor, target: number, strip?: number): BakeOutcome {
  const view = editor.getMutationView();
  const r = new AnchorEntityReader(store, view);
  const ties = readCombinations(store, view).filter((c) => c.target === target);
  const body = bodyOf(r, target);
  const targetFrame = nativeFrameOf(store, view, r, target);
  if (!body || !targetFrame) return { ok: false, reason: `#${target} has no body to combine` };
  const entity = (id: number) => r.entity(id);
  let own: number;
  if (body.items.length === 1) {
    own = body.items[0];
    for (let k = 0; k < (strip ?? ties.length) && combinationOf(entity, own); k++) own = refId(entity(own)!.attributes[1]) ?? own;
  } else {
    own = fold(editor, body.items, 'UNION');
  }
  const toTarget = invert(targetFrame);
  let result = own;
  for (const tie of ties) {
    const b = bodyOf(r, tie.tool);
    const f = nativeFrameOf(store, view, r, tie.tool);
    if (!b || !f) return { ok: false, reason: `#${tie.tool} has no body to combine` };
    const carry = compose(toTarget, f);
    const operands: number[] = [];
    for (const item of b.items) {
      const moved = carried(r, editor, item, carry);
      if (moved === null) return { ok: false, reason: `#${tie.tool}'s body (${r.entity(item)?.type}) cannot be combined` };
      operands.push(moved);
    }
    result = editor.addEntity('IfcBooleanResult', [`.${tie.op}.`, `#${result}`, `#${fold(editor, operands, 'UNION')}`] as Attr).expressId;
  }
  editor.setPositionalAttribute(body.repId, 2, representationType(r.entity(result)?.type));
  editor.setPositionalAttribute(body.repId, 3, [`#${result}`] as Attr[number]);
  return { ok: true, remesh: [target] };
}

/** Tie `tools` to `target` by `op`, live, and write its body. The tools stay as they are. */
export function combineElementsInStore(store: IfcDataStore, editor: StoreEditor, anchor: Anchor, target: number, tools: readonly number[], op: CombineOp): BakeOutcome {
  const name = 'combineElementsInStore';
  const registry = schemaRegistry(anchor.schema, name);
  const relClass = canonicalEntity(registry, 'IfcRelInterferesElements');
  if (!relClass) return { ok: false, reason: `${anchor.schema ?? 'IFC4'} has no IfcRelInterferesElements` };
  const view = editor.getMutationView();
  const before = readCombinations(store, view);
  const written = before.filter((c) => c.target === target).length;
  const tied = new Set(before.map((c) => `${c.target}:${c.tool}`));
  // A tool already in a combination (either way round) would loop or count twice.
  const busy = new Set(before.flatMap((c) => [c.tool, ...(c.target === target ? [] : [c.target])]));
  const fresh = tools.filter((t) => t !== target && !tied.has(`${target}:${t}`));
  const refused = fresh.find((t) => busy.has(t) || before.some((c) => c.target === t));
  if (refused !== undefined) return { ok: false, reason: `#${refused} is already combined with another element` };
  if (fresh.length === 0) return { ok: false, reason: 'No tool to combine' };
  for (const tool of fresh) {
    editor.addEntity(relClass, schemaAttributes(registry, relClass, {
      GlobalId: generateIfcGuid(anchor.guidRandom), OwnerHistory: ownerHistoryRef(anchor.ownerHistoryId), Name: NAMES[op],
      RelatingElement: `#${target}`, RelatedElement: `#${tool}`, InterferenceType: op === 'UNION' ? 'Union' : 'Intersection', ImpliedOrder: false,
    }, name) as Attr);
  }
  const out = rebakeCombinationInStore(store, editor, target, written);
  return out.ok ? { ok: true, remesh: [target, ...fresh] } : out;
}

/** Take away every tie `ids` take part in; each target gets its own body back. Returns the elements to re-mesh. */
export function separateCombinationsInStore(store: IfcDataStore, editor: StoreEditor, ids: readonly number[]): number[] {
  const view = editor.getMutationView();
  const all = readCombinations(store, view);
  const gone = all.filter((c) => ids.includes(c.target) || ids.includes(c.tool));
  const targets = [...new Set(gone.map((c) => c.target))];
  const written = new Map(targets.map((t) => [t, all.filter((c) => c.target === t).length]));
  for (const c of gone) editor.removeEntity(c.relId);
  for (const t of targets) rebakeCombinationInStore(store, editor, t, written.get(t));
  return [...new Set(gone.flatMap((c) => [c.target, c.tool]))];
}
