/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** EXTRUDE's pure parts: class words, a contour's loops with its islands, the view direction. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contourLoops, ifcClassFromWord } from './commands/model.js';
import { towardViewer } from '../project/contour-element.js';
import type { DraftEntity, DraftShape } from './types.js';

const entity = (id: string, shape: DraftShape, params: DraftEntity['params'] = {}): DraftEntity => ({ id, viewId: 'v', layerId: '0', shape, params });
const rect = (x: number, y: number, w: number, h: number): DraftShape => ({ type: 'polyline', closed: true, pts: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });

describe('ifcClassFromWord', () => {
  it('maps short words and accepts any IfcXxx', () => {
    assert.equal(ifcClassFromWord('slab'), 'IfcSlab');
    assert.equal(ifcClassFromWord('PROXY'), 'IfcBuildingElementProxy');
    assert.equal(ifcClassFromWord('IFCFOOTING'), 'IfcFooting');
    assert.equal(ifcClassFromWord('banana'), null);
  });
});

describe('contourLoops', () => {
  it('takes the contour and the first-level closed shapes inside it as voids', () => {
    const outer = entity('o', rect(0, 0, 10, 10));
    const hole = entity('h', rect(2, 2, 3, 3));
    const islandInHole = entity('i', rect(3, 3, 1, 1));
    const outside = entity('x', rect(20, 0, 2, 2));
    const loops = contourLoops(outer, [outer, hole, islandInHole, outside]);
    assert.equal(loops?.length, 2);
    assert.deepEqual(loops?.[1], (hole.shape as Extract<DraftShape, { type: 'polyline' }>).pts);
  });

  it('refuses an open shape', () => {
    assert.equal(contourLoops(entity('l', { type: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }), []), null);
  });
});

describe('towardViewer', () => {
  it('points out of the drawing toward the viewer', () => {
    assert.deepEqual(towardViewer({ axis: 'y', position: 0, flipped: false }), [0, 1, 0]);
    assert.deepEqual(towardViewer({ axis: 'x', position: 0, flipped: true }), [-1, 0, 0]);
  });
});
