/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faceOutersUnder, faceShape, FACE_PATTERN, pointOnFace, refreshedFaces } from './faces';
import type { DraftEntity, Pt } from './types';

const square = (id: string, x: number, y: number, size: number, params: DraftEntity['params'] = {}): DraftEntity => ({
  id, viewId: 'v', layerId: '0', params,
  shape: { type: 'polyline', closed: true, pts: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }] },
});

// A 100 m plate, a 40 m hole in it, a 20 m island in the hole, a 5 m hole in the island; a second hole beside.
const plate = square('plate', 0, 0, 100);
const hole = square('hole', 10, 10, 40);
const island = square('island', 20, 20, 20);
const pin = square('pin', 28, 28, 5);
const window2 = square('window2', 60, 60, 20);
const drafts = [plate, hole, island, pin, window2];

describe('faces', () => {
  it('alternate like a hatch: islands in holes are faces of their own, at any depth', () => {
    assert.deepEqual(faceOutersUnder(plate, drafts).map((e) => e.id), ['plate', 'island']);
    assert.deepEqual(faceOutersUnder(island, drafts).map((e) => e.id), ['island']);
  });

  it('take the first-level contours inside as holes', () => {
    const shape = faceShape(plate, drafts);
    assert.equal(shape?.type, 'hatch');
    if (shape?.type !== 'hatch') return;
    assert.equal(shape.pattern, FACE_PATTERN);
    assert.equal(shape.loops.length, 3, 'outline, the hole and the second hole — not the island inside the hole');
    const islandShape = faceShape(island, drafts);
    assert.equal(islandShape?.type === 'hatch' ? islandShape.loops.length : 0, 2);
  });

  it('cover their surface only, not their holes', () => {
    const face: DraftEntity = { id: 'f', viewId: 'v', layerId: '0', params: { face: 'plate' }, shape: faceShape(plate, drafts)! };
    const at = (x: number, y: number): Pt => ({ x, y });
    assert.equal(pointOnFace(at(5, 5), face), true);
    assert.equal(pointOnFace(at(15, 15), face), false, 'in the hole');
    assert.equal(pointOnFace(at(70, 70), face), false, 'in the second hole');
  });

  it('follow their contour: a contour drawn inside becomes a hole', () => {
    const face: DraftEntity = { id: 'f', viewId: 'v', layerId: '0', params: { face: 'plate' }, shape: faceShape(plate, [plate])! };
    const before = [plate, face];
    assert.equal(refreshedFaces(before).size, 0, 'in step');
    const after = [plate, square('new-hole', 80, 5, 10), face];
    const shape = refreshedFaces(after).get('f');
    assert.equal(shape?.type === 'hatch' ? shape.loops.length : 0, 2);
  });
});
