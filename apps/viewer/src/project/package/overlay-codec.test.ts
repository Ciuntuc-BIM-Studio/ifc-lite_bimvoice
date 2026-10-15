/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** An overlay snapshot, and what JSON cannot spell, survive the package's JSON codec. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { PropertyValueType, QuantityType } from '@ifc-lite/data';
import { decodeStructured, encodeStructured } from './overlay-codec.js';

describe('overlay codec', () => {
  it('keeps Maps, Sets, undefined, non-finite numbers, typed arrays and NUL-keyed objects', () => {
    const value = {
      map: new Map<unknown, unknown>([[1, 'a'], ['k', new Set([1, 2])]]),
      list: [undefined, null, NaN, Infinity, -Infinity, 0.1],
      typed: new Float64Array([1.5, NaN]),
      odd: { '\u0000m': 1, plain: 2 },
      nested: { a: { b: [new Map([[3, undefined]])] } },
    };
    assert.deepStrictEqual(decodeStructured(encodeStructured(value)), value);
  });

  it('a view restored from an encoded snapshot reads as the one captured', () => {
    const view = new MutablePropertyView(null, 'm');
    const wall = view.createEntity('IfcWall', ['0abcdefghijklmnopqrstu', null, 'W', null, null, null, null, null, '.STANDARD.']).expressId;
    view.createPropertySet(wall, 'Pset_WallCommon', [{ name: 'IsExternal', value: true, type: PropertyValueType.Boolean }]);
    view.createQuantitySet(wall, 'Qto_WallBaseQuantities', [{ name: 'NetVolume', value: NaN, quantityType: QuantityType.Volume }]);
    const gone = view.createEntity('IfcSlab', ['1abcdefghijklmnopqrstu', null, 'S', null, null, null, null, null, '.FLOOR.']).expressId;
    view.deleteEntity(gone);
    const snapshot = view.captureOverlaySnapshot();

    const restored = new MutablePropertyView(null, 'm');
    restored.restoreOverlaySnapshot(decodeStructured(encodeStructured(snapshot)) as typeof snapshot);
    assert.deepStrictEqual(restored.captureOverlaySnapshot(), snapshot);
    assert.equal(restored.getNewEntity(wall)?.type, 'IfcWall');
    assert.deepEqual([...restored.getNewEntitiesOfType('IFCWALL')].map((e) => e.expressId), [wall]);
  });
});
