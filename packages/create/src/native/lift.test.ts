/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Round trip native -> IFC (the existing writers, in a real parsed model) -> native (the lift). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { AnchorEntityReader, resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { resolveHostAnchor } from '../in-store/resolve-host.js';
import { addWallToStore } from '../in-store/wall.js';
import { addSlabToStore } from '../in-store/slab.js';
import { addBeamToStore } from '../in-store/beam.js';
import { addColumnToStore } from '../in-store/column.js';
import { addOpeningToStore } from '../in-store/opening.js';
import { addJoineryTypeToStore } from '../in-store/joinery-type.js';
import { defaultWindowSpec } from '../in-store/joinery-spec.js';
import { addHostedElementInStore } from '../in-store/hosted-element.js';
import { assignTypeInStore } from '../in-store/element-type.js';
import { ensureCatalogTypeInStore } from '../in-store/catalog-type.js';
import { readRelatedLists } from '../in-store/resolve-relations.js';
import { liftNativeModel } from './lift.js';
import { nativeIdOf } from './lift-base.js';
import { nativeIndex } from './validate.js';
import { beamStoreParams, columnStoreParams, joineryStoreParams, openingStoreParams, slabStoreParams, wallStoreParams } from './to-store-params.js';
import { nativeGlobalId } from './ifc-mapping.js';
import { NATIVE_SCHEMA_VERSION, type NativeElement, type NativeJoinery, type NativeModel, type NativeWall } from './schema.js';

async function helloWall(): Promise<IfcDataStore> {
  const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
  return new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
}

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

describe('native round trip through the IFC writers', () => {
  it('lifts back the walls, slab, beam, column and opening it wrote, with the same ids', async () => {
    const store = await helloWall();
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyExpress, view);
    const storeyId = nativeIdOf(new AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;

    const elements: NativeElement[] = [
      { id: id(1), kind: 'wall', storeyId, start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7, name: 'W-north', tag: 'W1' },
      { id: id(2), kind: 'wall', storeyId, start: [6, 0], end: [6, 4], thickness: 0.2, height: 2.7, baseOffset: 0.1, offset: 0.05, endCut: { left: 0.1, right: -0.1 } },
      { id: id(3), kind: 'slab', storeyId, outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25, topOffset: 0 },
      { id: id(4), kind: 'beam', storeyId, start: [0, 2, 2.6], end: [6, 2, 2.6], section: { Type: 'Rectangle', XDim: 0.2, YDim: 0.4 } },
      { id: id(5), kind: 'column', storeyId, position: [3, 2, 0], height: 2.6, rotation: Math.PI / 6, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.4 } },
      { id: id(6), kind: 'opening', host: 'wall', storeyId, hostId: id(1), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
    ];
    const native: NativeModel = {
      schemaVersion: NATIVE_SCHEMA_VERSION, id: id(100), name: 'rt',
      storeys: [{ id: storeyId, name: '', elevation: 0 }], elements, types: [], materials: [], relations: [], properties: [],
    };
    const index = nativeIndex(native);
    const expressOf = new Map<string, number>();
    for (const el of elements) {
      if (el.kind === 'wall') expressOf.set(el.id, addWallToStore(editor, anchor, wallStoreParams(el, index)).wallId);
      if (el.kind === 'slab') expressOf.set(el.id, addSlabToStore(editor, anchor, slabStoreParams(el, index)).slabId);
      if (el.kind === 'beam') expressOf.set(el.id, addBeamToStore(editor, anchor, beamStoreParams(el, index)).beamId);
      if (el.kind === 'column') expressOf.set(el.id, addColumnToStore(editor, anchor, columnStoreParams(el, index)).columnId);
      if (el.kind === 'opening') {
        const host = resolveHostAnchor(store, expressOf.get(el.hostId)!, view);
        expressOf.set(el.id, addOpeningToStore(editor, host, openingStoreParams(el, index)).openingId);
      }
    }

    const { model, expressIds, skipped } = liftNativeModel(store, view, { id: id(100), name: 'rt' });
    for (const el of elements) {
      expect(expressIds.get(el.id), `${el.kind} ${el.id} lifted`).toBe(expressOf.get(el.id));
    }
    const lifted = new Map(model.elements.map((e) => [e.id, e]));
    expect(lifted.get(id(1))).toMatchObject({ kind: 'wall', start: [0, 0], end: [6, 0], thickness: 0.3, height: 2.7, name: 'W-north', tag: 'W1' });
    expect(lifted.get(id(2))).toMatchObject({ start: [6, 0], end: [6, 4], thickness: 0.2, baseOffset: 0.1, offset: 0.05, endCut: { left: 0.1, right: -0.1 } });
    expect(lifted.get(id(3))).toMatchObject({ kind: 'slab', outline: [[0, 0], [6, 0], [6, 4], [0, 4]], thickness: 0.25 });
    expect((lifted.get(id(3)) as { topOffset?: number }).topOffset ?? 0).toBe(0);
    expect(lifted.get(id(4))).toMatchObject({ kind: 'beam', start: [0, 2, 2.6], end: [6, 2, 2.6], section: { Type: 'Rectangle', XDim: 0.2, YDim: 0.4 } });
    const column = lifted.get(id(5)) as { position: number[]; height: number; rotation?: number };
    expect(column).toMatchObject({ kind: 'column', position: [3, 2, 0], height: 2.6 });
    expect(column.rotation).toBeCloseTo(Math.PI / 6, 6);
    expect(lifted.get(id(6))).toMatchObject({ kind: 'opening', host: 'wall', hostId: id(1), along: 2, sill: 0.9 });
    const opening = lifted.get(id(6)) as { width: number; height: number };
    expect(opening.width).toBeCloseTo(1.2, 6);
    expect(opening.height).toBeCloseTo(1.4, 6);
    // Nothing this test wrote was skipped; the sample's own elements may be.
    expect(skipped.filter((s) => [...expressOf.values()].includes(s.expressId))).toEqual([]);
  });

  it('lifts a typed wall with its layers and a window with its joinery type, sill and flips', async () => {
    const store = await helloWall();
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storeyExpress = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const anchor = resolveSpatialAnchor(store, storeyExpress, view);
    const storeyId = nativeIdOf(new AnchorEntityReader(store, view).entity(storeyExpress)?.attributes[0])!;
    const spec = { ...defaultWindowSpec('W-120'), board: { interior: 0, exterior: 0 } };
    const native: NativeModel = {
      schemaVersion: NATIVE_SCHEMA_VERSION, id: id(200), name: 'rt2',
      storeys: [{ id: storeyId, name: '', elevation: 0 }],
      elements: [
        { id: id(201), kind: 'wall', storeyId, start: [0, 0], end: [8, 0], thickness: 0.3, height: 3 },
        { id: id(202), kind: 'window', storeyId, hostId: id(201), typeId: id(203), along: 4, sill: 1 },
      ],
      types: [{ id: id(203), kind: 'window', name: 'W-120', spec }],
      materials: [], relations: [], properties: [],
    };
    const index = nativeIndex(native);
    const wallId = addWallToStore(editor, anchor, wallStoreParams(native.elements[0] as NativeWall, index)).wallId;
    const wallType = ensureCatalogTypeInStore(store, editor, anchor, {
      id: 'wt-1', ifcClass: 'IfcWallType', name: 'WT1',
      layers: [{ name: 'Brick', thickness: 0.25 }, { name: 'Plaster', thickness: 0.05 }],
      spec: { kind: 'wall', id: 'wt-1', name: 'WT1', mark: 'WT1', height: 3, layers: [{ name: 'Brick', thickness: 0.25 }, { name: 'Plaster', thickness: 0.05 }] },
    });
    assignTypeInStore(editor, anchor, wallType.typeId, [wallId], readRelatedLists(store, 'IfcRelDefinesByType', view));
    const host = resolveHostAnchor(store, wallId, view);
    const type = addJoineryTypeToStore(editor, host, spec, { GlobalId: nativeGlobalId(id(203)) });
    const placed = joineryStoreParams(native.elements[1] as NativeJoinery, index);
    const win = addHostedElementInStore(store, editor, wallId, placed.kind === 'window'
      ? { kind: 'window', params: { ...placed.params, MappedBody: type.mapId } }
      : { kind: 'door', params: { ...placed.params, MappedBody: type.mapId } });
    assignTypeInStore(editor, host, type.typeId, [win.expressId], readRelatedLists(store, 'IfcRelDefinesByType', view));

    const { model, skipped } = liftNativeModel(store, view, { id: id(200), name: 'rt2' });
    const wall = model.elements.find((e) => e.id === id(201));
    const wt = model.types.find((t) => t.name === 'WT1');
    expect(wt).toMatchObject({ kind: 'wall', height: 3 });
    expect(wt && 'layers' in wt ? wt.layers.map((l) => l.thickness) : []).toEqual([0.25, 0.05]);
    expect(model.materials.map((m) => m.name).sort()).toEqual(['Brick', 'Plaster']);
    expect(wall?.typeId).toBe(wt?.id);
    expect(model.types.find((t) => t.id === id(203))).toMatchObject({ kind: 'window', name: 'W-120' });
    expect(model.elements.find((e) => e.id === id(202))).toMatchObject({ kind: 'window', hostId: id(201), typeId: id(203), along: 4, sill: 1 });
    // The window brings its opening: the opening is not a native element of its own.
    expect(model.elements.filter((e) => e.kind === 'opening')).toEqual([]);
    expect(skipped.filter((s) => s.expressId === win.expressId || s.expressId === wallId)).toEqual([]);
  });
});
