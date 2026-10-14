/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { MutablePropertyView, StoreEditor, type MutationEntityRef, type MutationStoreShape } from '@ifc-lite/mutations';
import { addWallToStore } from '../in-store/wall.js';
import { defaultWindowSpec } from '../in-store/joinery-spec.js';
import {
  NATIVE_IFC, NATIVE_SCHEMA_VERSION, nativeGlobalId, nativeIdFromGlobalId, nativePredefinedType,
  nativeElementProblems, nativeIndex, nativeModelProblems, resolveNativeParam,
  columnStoreParams, openingStoreParams, slabStoreParams, wallStoreParams,
  type NativeModel, type NativeWall,
} from './index.js';

const STOREY = '00000000-0000-4000-8000-000000000001';
const WALL_TYPE = '00000000-0000-4000-8000-000000000002';
const CONCRETE = '00000000-0000-4000-8000-000000000003';
const WINDOW_TYPE = '00000000-0000-4000-8000-000000000004';
const WALL = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function model(extra: Partial<NativeModel> = {}): NativeModel {
  const wall: NativeWall = { id: WALL, kind: 'wall', storeyId: STOREY, typeId: WALL_TYPE, start: [0, 0], end: [5, 0], name: 'North' };
  return {
    schemaVersion: NATIVE_SCHEMA_VERSION, id: '00000000-0000-4000-8000-0000000000aa', name: 'Test',
    storeys: [{ id: STOREY, name: 'Ground', elevation: 0 }],
    types: [
      { id: WALL_TYPE, kind: 'wall', name: 'WT1', height: 2.8, layers: [{ materialId: CONCRETE, thickness: 0.2 }, { materialId: CONCRETE, thickness: 0.05 }] },
      { id: WINDOW_TYPE, kind: 'window', name: 'W1', spec: defaultWindowSpec('W1') },
    ],
    materials: [{ id: CONCRETE, name: 'Concrete' }],
    elements: [wall],
    relations: [], properties: [],
    ...extra,
  };
}

describe('native ids and IFC classes', () => {
  it('derives a stable GlobalId from the UUID and reads the UUID back', () => {
    const guid = nativeGlobalId(WALL);
    expect(guid).toHaveLength(22);
    expect(nativeGlobalId(WALL)).toBe(guid);
    expect(nativeIdFromGlobalId(guid)).toBe(WALL);
    expect(() => nativeGlobalId('wall-1')).toThrow(/not a UUID/);
  });

  it('writes the element PredefinedType when the class allows it, else the class default', () => {
    expect(nativePredefinedType({ kind: 'wall' })).toBe('STANDARD');
    expect(nativePredefinedType({ kind: 'wall', predefinedType: 'parapet' })).toBe('PARAPET');
    expect(nativePredefinedType({ kind: 'slab', predefinedType: 'GIRDER' })).toBe('FLOOR');
    expect(NATIVE_IFC.beam.material).toBe('profileSetUsage');
    expect(NATIVE_IFC.window.ifcClass).toBe('IfcWindow');
  });
});

describe('native resolution and validation', () => {
  it('takes thickness and height from the type when the element leaves them open', () => {
    const m = model();
    const index = nativeIndex(m);
    const wall = m.elements[0];
    expect(resolveNativeParam(wall, 'thickness', index)).toBeCloseTo(0.25);
    expect(resolveNativeParam(wall, 'height', index)).toBe(2.8);
    expect(resolveNativeParam(wall, 'alignment', index)).toBe('center');
    expect(resolveNativeParam({ ...wall, height: 3.1 } as NativeWall, 'height', index)).toBe(3.1);
    expect(nativeModelProblems(m).size).toBe(0);
  });

  it('reports what keeps an element from being built', () => {
    const m = model();
    const index = nativeIndex(m);
    const untyped: NativeWall = { id: '00000000-0000-4000-8000-000000000010', kind: 'wall', storeyId: 'nowhere', start: [1, 1], end: [1, 1] };
    expect(nativeElementProblems(untyped, index)).toEqual([
      'storey nowhere does not exist',
      'start and end must be distinct',
      'height is required (on the element or its type)',
      'thickness is required (on the element or its type)',
    ]);
    expect(nativeElementProblems({ ...untyped, storeyId: STOREY, end: [2, 1], typeId: WINDOW_TYPE, thickness: -1, height: 3 }, index)).toEqual([
      `type ${WINDOW_TYPE} is a window type, not a wall type`,
      'thickness must be greater than 0',
    ]);
  });

  it('checks hosts, joinery types, outlines and duplicate ids', () => {
    const m = model({
      elements: [
        ...model().elements,
        { id: '00000000-0000-4000-8000-000000000020', kind: 'window', storeyId: STOREY, hostId: WALL, along: 2 },
        { id: '00000000-0000-4000-8000-000000000021', kind: 'opening', host: 'slab', storeyId: STOREY, hostId: WALL, center: [1, 1], width: 1, depth: 1 },
        { id: '00000000-0000-4000-8000-000000000022', kind: 'slab', storeyId: STOREY, outline: [[0, 0], [1, 0], [2, 0]], thickness: 0.2 },
        { id: WALL, kind: 'wall', storeyId: STOREY, start: [0, 0], end: [1, 0], thickness: 0.2, height: 3 },
      ],
    });
    const problems = nativeModelProblems(m);
    expect(problems.get('00000000-0000-4000-8000-000000000020')).toEqual(['a window needs its joinery type']);
    expect(problems.get('00000000-0000-4000-8000-000000000021')).toEqual([`host ${WALL} is a wall, not a slab`]);
    expect(problems.get('00000000-0000-4000-8000-000000000022')).toEqual(['outline encloses no area']);
    expect(problems.get(WALL)).toEqual([`duplicate id ${WALL}`]);
  });

  it('takes a window sill from its joinery type', () => {
    const m = model();
    const win = { id: '00000000-0000-4000-8000-000000000030', kind: 'window' as const, storeyId: STOREY, hostId: WALL, typeId: WINDOW_TYPE, along: 2 };
    expect(resolveNativeParam(win, 'sill', nativeIndex(m))).toBe(0.9);
    expect(nativeElementProblems(win, nativeIndex(m))).toEqual([]);
  });
});

describe('native -> IFC writer parameters', () => {
  it('projects a typed wall onto addWallToStore, with its GlobalId', () => {
    const m = model();
    const params = wallStoreParams({ ...(m.elements[0] as NativeWall), baseOffset: 0.1, alignment: 'left' }, nativeIndex(m));
    expect(params).toMatchObject({ Start: [0, 0, 0.1], End: [5, 0, 0.1], Height: 2.8, Alignment: 'left', Name: 'North', GlobalId: nativeGlobalId(WALL) });
    expect(params.Thickness).toBeCloseTo(0.25);

    const byId = new Map<number, MutationEntityRef>();
    for (let id = 1; id <= 60; id++) byId.set(id, { expressId: id, type: 'IFCDUMMY', byteOffset: 0, byteLength: 1, lineNumber: id });
    const store: MutationStoreShape = { entityIndex: { byId } };
    const view = new MutablePropertyView(null, 'm1');
    const built = addWallToStore(new StoreEditor(store, view),
      { ownerHistoryId: 5, bodyContextId: 14, axisContextId: 15, storeyId: 43, storeyPlacementId: 54 }, params);
    const wall = view.getNewEntities().find((e) => e.expressId === built.wallId);
    expect(wall?.type).toBe('IfcWall');
    expect(wall?.attributes[0]).toBe(nativeGlobalId(WALL));
  });

  it('places a slab below its top and turns a column by its rotation', () => {
    const m = model();
    const index = nativeIndex(m);
    const slab = slabStoreParams({ id: '00000000-0000-4000-8000-000000000040', kind: 'slab', storeyId: STOREY, outline: [[0, 0], [4, 0], [4, 3], [0, 3]], thickness: 0.25, topOffset: 0 }, index);
    expect(slab).toMatchObject({ Profile: 'polygon', Position: [0, 0, -0.25], Thickness: 0.25 });
    const column = columnStoreParams({ id: '00000000-0000-4000-8000-000000000041', kind: 'column', storeyId: STOREY, position: [1, 1, 0], height: 3, rotation: Math.PI / 2, section: { Type: 'Rectangle', XDim: 0.3, YDim: 0.3 } }, index);
    expect(column.RefDirection?.[0]).toBeCloseTo(0);
    expect(column.RefDirection?.[1]).toBeCloseTo(1);
    expect(column.Height).toBe(3);
  });

  it('places a wall opening in the wall frame and names what the writers cannot do yet', () => {
    const m = model();
    const index = nativeIndex(m);
    expect(openingStoreParams({ id: '00000000-0000-4000-8000-000000000050', kind: 'opening', host: 'wall', storeyId: STOREY, hostId: WALL, along: 2, sill: 0.9, width: 1.2, height: 1.4 }, index))
      .toMatchObject({ Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.4 });
    expect(() => slabStoreParams({ id: '00000000-0000-4000-8000-000000000051', kind: 'slab', storeyId: STOREY, outline: [[0, 0], [4, 0], [4, 3]], holes: [[[1, 1], [1, 2], [2, 1]]], thickness: 0.2 }, index))
      .toThrow(/a slab with holes is not supported/);
    expect(() => wallStoreParams({ id: WALL, kind: 'wall', storeyId: STOREY, start: [0, 0], end: [0, 0], thickness: 0.2, height: 3 }, index))
      .toThrow(/start and end must be distinct/);
  });
});
