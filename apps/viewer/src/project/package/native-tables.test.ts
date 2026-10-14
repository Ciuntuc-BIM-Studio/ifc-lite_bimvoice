/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** A native model survives its Arrow IPC tables field for field, absent fields staying absent. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWindowSpec, NATIVE_SCHEMA_VERSION, type NativeModel } from '@ifc-lite/create';
import { nativeModelFromTables, nativeTablesFromModel, readNativeTable } from './native-tables.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const model: NativeModel = {
  schemaVersion: NATIVE_SCHEMA_VERSION, id: id(1), name: 'Casa',
  storeys: [{ id: id(2), name: 'Parter', elevation: 0 }, { id: id(3), name: 'Etaj 1', elevation: 2.8 }],
  materials: [{ id: id(4), name: 'Brick', color: '#b5651d' }],
  types: [
    { id: id(5), kind: 'wall', name: 'WT1', mark: 'WT1', height: 2.8, layers: [{ materialId: id(4), thickness: 0.25 }] },
    { id: id(6), kind: 'window', name: 'W1', spec: defaultWindowSpec('W1') },
  ],
  elements: [
    { id: id(10), kind: 'wall', storeyId: id(2), typeId: id(5), start: [0, 0], end: [6, 0], name: 'North', endCut: { left: 0.1, right: -0.1 } },
    { id: id(11), kind: 'wall', storeyId: id(2), start: [6, 0], end: [6, 4], thickness: 0.2, height: 2.7, baseOffset: 0.1, alignment: 'left', flipLayers: true },
    { id: id(12), kind: 'slab', storeyId: id(3), outline: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [[[1, 1], [1, 2], [2, 2]]], thickness: 0.25 },
    { id: id(13), kind: 'beam', storeyId: id(2), start: [0, 2, 2.6], end: [6, 2, 2.6], section: { Type: 'I', OverallWidth: 0.2, OverallDepth: 0.4, WebThickness: 0.01, FlangeThickness: 0.015 } },
    { id: id(14), kind: 'column', storeyId: id(2), position: [3, 2, 0], height: 2.6, rotation: 0.5, section: { Type: 'Circle', Radius: 0.15 } },
    { id: id(15), kind: 'opening', host: 'wall', storeyId: id(2), hostId: id(10), along: 2, sill: 0.9, width: 1.2, height: 1.4 },
    { id: id(16), kind: 'opening', host: 'slab', storeyId: id(3), hostId: id(12), center: [4, 3], width: 0.8, depth: 0.6 },
    { id: id(17), kind: 'window', storeyId: id(2), hostId: id(10), typeId: id(6), along: 4, sill: 1, flipHand: true },
  ],
  relations: [{ kind: 'wallJoin', a: id(10), b: id(11), style: 'mitre' }],
  properties: [{ elementId: id(10), pset: 'Pset_WallCommon', name: 'IsExternal', value: true, ifcType: 'IfcBoolean' }],
};

describe('native Arrow tables', () => {
  it('reads back what it wrote', () => {
    const files = nativeTablesFromModel(model);
    const back = nativeModelFromTables(files);
    const byId = new Map(back.elements.map((e) => [e.id, e]));
    for (const element of model.elements) assert.deepEqual(byId.get(element.id), element, `${element.kind} ${element.id}`);
    assert.equal(back.elements.length, model.elements.length);
    assert.deepEqual({ ...back, elements: [] }, { ...model, elements: [] });
  });

  it('writes one typed table per class, with coordinates as Float64 columns', () => {
    const files = nativeTablesFromModel(model);
    assert.deepEqual([...files.keys()].filter((p) => p.startsWith('elements/')).sort(),
      ['elements/beam.arrow', 'elements/column.arrow', 'elements/opening.arrow', 'elements/slab.arrow', 'elements/wall.arrow', 'elements/window.arrow']);
    const walls = readNativeTable(files.get('elements/wall.arrow')!);
    assert.equal(walls.numRows, 2);
    assert.equal(String(walls.schema.fields.find((f) => f.name === 'start_x')?.type), 'Float64');
    assert.deepEqual(Array.from(walls.getChild('end_y')!.toArray() as Float64Array), [0, 4]);
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    assert.equal(manifest.tables['elements/opening.arrow'], 2);
    assert.equal(manifest.schemaVersion, NATIVE_SCHEMA_VERSION);
  });
});
