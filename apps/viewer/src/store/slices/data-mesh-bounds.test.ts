/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { CoordinateInfo, MeshData } from '@ifc-lite/geometry';
import { growCoordinateInfo } from './data-mesh-bounds.js';

const info = (min: number, max: number, shift = 0): CoordinateInfo => ({
  originShift: { x: shift, y: 0, z: 0 },
  originalBounds: { min: { x: min + shift, y: min, z: min }, max: { x: max + shift, y: max, z: max } },
  shiftedBounds: { min: { x: min, y: min, z: min }, max: { x: max, y: max, z: max } },
  hasLargeCoordinates: false,
});
const mesh = (...pts: number[]): MeshData => ({ positions: new Float32Array(pts) } as unknown as MeshData);

describe('growCoordinateInfo', () => {
  it('starts from the meshes when the model had no geometry', () => {
    const grown = growCoordinateInfo(info(0, 0, 100), [mesh(-2, 0, 1, 3, 4, 5)]);
    assert.deepEqual(grown.shiftedBounds, { min: { x: -2, y: 0, z: 1 }, max: { x: 3, y: 4, z: 5 } });
    assert.deepEqual(grown.originalBounds.min, { x: 98, y: 0, z: 1 });
  });

  it('grows past the load-time bounds, never shrinks', () => {
    const grown = growCoordinateInfo(info(0, 10), [mesh(5, 5, 5, 12, 1, 1)]);
    assert.deepEqual(grown.shiftedBounds, { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 10, z: 10 } });
  });

  it('keeps the same object when the meshes already fit', () => {
    const before = info(0, 10);
    assert.equal(growCoordinateInfo(before, [mesh(1, 2, 3)]), before);
  });
});
