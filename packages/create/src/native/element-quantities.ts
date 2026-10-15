/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The base quantities of ONE element, from its native parameters (N3): the
 * set an IFC export gives it (`export-sets.ts`), for the properties panel to
 * show live, as an imported IFC's `Qto_*` shows. Only what the element needs
 * is read — its storey, its host and the openings in it, the joinery types
 * involved — through the relationship lookups of an edit's re-mesh, so it
 * costs the element, not the model.
 */

import { RelationshipType } from '@ifc-lite/data';
import { StoreEditor, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { AnchorEntityReader } from '../in-store/resolve-anchor.js';
import { containingStructure } from '../in-store/containment-index.js';
import { getModelLengthUnitScale } from '../in-store/edit/length-unit-scale.js';
import { readJoineryType } from '../in-store/joinery-read.js';
import { nativeQuantities } from './export-sets.js';
import { liftSlab, liftWall } from './lift.js';
import { liftHosted, liftLinear } from './lift-members.js';
import { liftSolid } from './solid.js';
import { nativeIdOf, type LiftContext } from './lift-base.js';
import { RelationLookup, type RelationKind } from './relation-lookup.js';
import { refId } from './remesh-context.js';
import type { NativeElement, NativeType } from './schema.js';
import { nativeIndex } from './validate.js';

const pairsOf = (relating: number, related: number, flip: boolean) =>
  (rel: { attributes: unknown[] }): Array<[number, number]> => {
    const a = refId(rel.attributes[relating]);
    const bs = Array.isArray(rel.attributes[related]) ? (rel.attributes[related] as unknown[]).map(refId) : [refId(rel.attributes[related])];
    return a === null ? [] : bs.flatMap((b) => (b === null ? [] : [flip ? [b, a] as [number, number] : [a, b] as [number, number]]));
  };

const OPENINGS: RelationKind = { type: 'IFCRELVOIDSELEMENT', edge: RelationshipType.VoidsElement, direction: 'forward', pairs: pairsOf(4, 5, false) };
const HOST: RelationKind = { type: 'IFCRELVOIDSELEMENT', edge: RelationshipType.VoidsElement, direction: 'inverse', pairs: pairsOf(4, 5, true) };
const FILLING: RelationKind = { type: 'IFCRELFILLSELEMENT', edge: RelationshipType.FillsElement, direction: 'forward', pairs: pairsOf(4, 5, false) };
const FILLED: RelationKind = { type: 'IFCRELFILLSELEMENT', edge: RelationshipType.FillsElement, direction: 'inverse', pairs: pairsOf(4, 5, true) };
const TYPE: RelationKind = { type: 'IFCRELDEFINESBYTYPE', edge: RelationshipType.DefinesByType, direction: 'inverse', pairs: pairsOf(5, 4, true) };

export interface ElementQuantities {
  /** The standard base quantity set of its class (`Qto_WallBaseQuantities`, ...). */
  set: string;
  quantities: Array<{ name: string; value: number; quantityType: number }>;
}

/** `expressId`'s base quantities from its native parameters, or null when it is not a native element. */
export function nativeElementQuantities(store: IfcDataStore, view: MutablePropertyView, expressId: number): ElementQuantities | null {
  const reader = new AnchorEntityReader(store, view);
  const look = (kind: RelationKind) => new RelationLookup(store, view, reader, kind);
  const [openingsOf, hostOf, fillingOf, filledBy, typeOf] = [look(OPENINGS), look(HOST), look(FILLING), look(FILLED), look(TYPE)];
  const ctx: LiftContext = {
    store, view, editor: new StoreEditor(store, view), reader, scale: getModelLengthUnitScale(store),
    storeyOf: new Map(), storeyExpressOf: new Map(), typeOf: new Map(), lifted: new Map(), skipped: [], partOf: new Map(),
  };
  const types = new Map<string, NativeType>();
  const storeys: Array<{ id: string; name: string; elevation: number }> = [];
  const contain = (id: number) => {
    const storey = containingStructure(store, view, reader, id);
    const storeyId = storey === null ? null : nativeIdOf(reader.entity(storey)?.attributes[0]);
    if (storey === null || !storeyId) return;
    ctx.storeyOf.set(id, storeyId);
    ctx.storeyExpressOf.set(storeyId, storey);
    if (!storeys.some((s) => s.id === storeyId)) storeys.push({ id: storeyId, name: '', elevation: 0 });
  };
  const typeJoinery = (filling: number) => {
    const typeId = typeOf.get(filling)?.[0];
    const read = typeId === undefined ? null : readJoineryType(store, typeId, view);
    const nativeType = typeId === undefined ? null : nativeIdOf(reader.entity(typeId)?.attributes[0]);
    if (!read || !nativeType) return;
    ctx.typeOf.set(filling, nativeType);
    types.set(nativeType, { id: nativeType, kind: read.spec.kind, name: read.spec.name, spec: read.spec });
  };
  const liftHost = (host: number): NativeElement | null => {
    contain(host);
    const type = reader.entity(host)?.type.toUpperCase();
    const e = type === 'IFCWALL' || type === 'IFCWALLSTANDARDCASE' ? liftWall(ctx, host) : type === 'IFCSLAB' ? liftSlab(ctx, host) : null;
    if (e) ctx.lifted.set(host, e);
    return e;
  };
  const known = { hostOf: (o: number) => hostOf.get(o)?.[0] ?? null, fillingOf: (o: number) => fillingOf.get(o)?.[0] ?? null };
  /** The openings in `host`, lifted (with their doors and windows). */
  const liftOpeningsOf = (host: number) => {
    const openings = openingsOf.get(host) ?? [];
    for (const o of openings) { const f = known.fillingOf(o); if (f !== null) typeJoinery(f); }
    liftHosted(ctx, openings, known);
  };

  const type = reader.entity(expressId)?.type.toUpperCase();
  if (!type) return null;
  let element: NativeElement | null = null;
  if (type === 'IFCWALL' || type === 'IFCWALLSTANDARDCASE' || type === 'IFCSLAB') {
    element = liftHost(expressId);
    if (element) liftOpeningsOf(expressId);
  } else if (type === 'IFCBEAM' || type === 'IFCCOLUMN') {
    contain(expressId);
    element = liftLinear(ctx, expressId, type === 'IFCBEAM' ? 'beam' : 'column');
  } else if (type === 'IFCOPENINGELEMENT' || type === 'IFCDOOR' || type === 'IFCWINDOW') {
    const opening = type === 'IFCOPENINGELEMENT' ? expressId : filledBy.get(expressId)?.[0];
    const host = opening === undefined ? undefined : known.hostOf(opening);
    if (opening !== undefined && host !== null && host !== undefined && liftHost(host)) {
      if (type !== 'IFCOPENINGELEMENT') typeJoinery(expressId);
      liftHosted(ctx, [opening], known);
      element = ctx.lifted.get(expressId) ?? null;
    }
  }
  // Anything Studio built that is not its class's parametric shape: a solid, from its history.
  if (!element) {
    contain(expressId);
    element = liftSolid(ctx, expressId);
    if (element) ctx.lifted.set(expressId, element);
  }
  if (!element) return null;
  const elements = [...ctx.lifted.values()];
  const index = nativeIndex({ elements, types: [...types.values()], storeys });
  const hosted = elements.filter((e) => 'hostId' in e && e.hostId === element!.id);
  const out = nativeQuantities(element, index, hosted);
  return out ? { set: out.set, quantities: out.quantities.map((q) => ({ name: q.name, value: q.value, quantityType: q.quantityType })) } : null;
}
