/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetProject, useProjectStore } from './project-store';
import { elementType } from '@/element-types/catalog';
import { addCltType, cltMaterialName, cltName, CLT_LAYUPS } from './clt';

beforeEach(() => resetProject());

describe('CLT types', () => {
  it('a 5-layer wall: lamellae alternating along and across, its two materials hatched, the current wall type', () => {
    const id = addCltType({ kind: 'wall', layers: [...CLT_LAYUPS[5]], grade: 'C24' });
    const type = elementType(id);
    assert.ok(type && type.kind === 'wall');
    if (!type || type.kind !== 'wall') return;
    assert.equal(type.name, 'CLT 140 5s C24');
    assert.deepEqual(type.layers.map((l) => l.name), ['CLT C24 0°', 'CLT C24 90°', 'CLT C24 0°', 'CLT C24 90°', 'CLT C24 0°']);
    assert.deepEqual(type.layers.map((l) => l.thickness), CLT_LAYUPS[5]);
    assert.equal(useProjectStore.getState().currentTypes?.wall, id);
    const materials = useProjectStore.getState().materials ?? [];
    assert.equal(materials.find((m) => m.name === cltMaterialName('C24', true))?.hatch, 'WOOD');
    assert.equal(materials.find((m) => m.name === cltMaterialName('C24', false))?.hatch, 'WOODCROSS');
  });

  it('a slab keeps its name when given one, and refuses fewer than three lamellae', () => {
    const id = addCltType({ kind: 'slab', layers: [...CLT_LAYUPS[3]], grade: 'GL24h', name: 'Floor CLT' });
    assert.equal(elementType(id)?.name, 'Floor CLT');
    assert.equal(useProjectStore.getState().currentTypes?.slab, id);
    assert.equal(cltName({ kind: 'slab', layers: CLT_LAYUPS[3], grade: 'GL24h' }), 'CLT 100 3s GL24h slab');
    assert.throws(() => addCltType({ kind: 'wall', layers: [0.1, 0.1], grade: 'C24' }), /three/);
  });
});
