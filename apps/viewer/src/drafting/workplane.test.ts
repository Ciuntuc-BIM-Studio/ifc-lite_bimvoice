/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Work planes: a plan section line gives a vertical plane through it that
 * keeps the picked side, and drafted lines lift onto their view plane in 3D.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sectionPlaneFromLine } from './commands/workplane.js';
import { liftedVertices } from '../hooks/useDraftingLines3D.js';
import { viewPlaneConfig } from '../project/view-plane-config.js';
import type { ProjectView } from '../project/types.js';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);
const plan = { axis: 'y' as const, position: 1.2, flipped: false };

describe('sectionPlaneFromLine', () => {
  it('stands vertical through the line and keeps the picked side', () => {
    const plane = sectionPlaneFromLine(plan, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 });
    assert.ok(plane);
    if (!plane) return;
    // Plan drawing y is world z: the side at z = 3 is kept, so the normal points to −z.
    assert.deepEqual(plane.normal.map((v) => v + 0), [0, 0, -1]);
    near(plane.distance, 0);
    assert.deepEqual(plane.bitangent, [0, 1, 0]);
    // Looking toward +z with y up, screen right is −x.
    assert.deepEqual(plane.tangent.map((v) => v + 0), [-1, 0, 0]);
    const kept = { x: 5, y: 0, z: 3 };
    assert.ok(kept.x * plane.normal[0] + kept.y * plane.normal[1] + kept.z * plane.normal[2] - plane.distance < 0);
  });

  it('refuses a zero-length line', () => {
    assert.equal(sectionPlaneFromLine(plan, { x: 1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  });
});

describe('liftedVertices', () => {
  it('puts a line drafted on a plan at the plan cut height', () => {
    const v = liftedVertices([{ id: 'd', viewId: 'p', layerId: '0', params: {}, shape: { type: 'line', a: { x: 1, y: 2 }, b: { x: 4, y: 2 } } }], plan);
    assert.deepEqual(v, [1, 1.2, 2, 4, 1.2, 2]);
  });
});

describe('viewPlaneConfig', () => {
  it('gives an empty project plan its work plane without any drawing', () => {
    const view: ProjectView = { id: 'p', name: 'L0', createdAt: 0, kind: 'plan', level: { name: 'L0', elevation: 3, storeyGlobalIds: [] }, cutHeight: 1.2 };
    assert.deepEqual(viewPlaneConfig(view, [], null), { axis: 'y', position: 4.2, flipped: false });
  });
});
