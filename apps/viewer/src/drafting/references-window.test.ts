/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Drawing2D } from '@ifc-lite/drawing-2d';
import { modelElementsInWindow } from './references';

const square = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const drawing = {
  cutPolygons: [
    { entityId: 1, polygon: { outer: square(0, 0, 1), holes: [] } },
    { entityId: 2, polygon: { outer: square(3, 0, 1), holes: [] } },
    { entityId: 3, polygon: { outer: square(10, 10, 10), holes: [] } },
  ],
  lines: [{ entityId: 4, visibility: 'visible', line: { start: { x: 0, y: 5 }, end: { x: 5, y: 10 } } }],
} as unknown as Drawing2D;

describe('model elements in a drawn window', () => {
  it('a window takes what is wholly inside it', () => {
    assert.deepEqual(modelElementsInWindow(drawing, { x: -1, y: -1 }, { x: 3.5, y: 2 }, false), [1]);
  });

  it('a crossing takes what it touches, and an outline it lies within', () => {
    assert.deepEqual(modelElementsInWindow(drawing, { x: -1, y: -1 }, { x: 3.5, y: 2 }, true).sort(), [1, 2]);
    assert.deepEqual(modelElementsInWindow(drawing, { x: 14, y: 14 }, { x: 15, y: 15 }, true), [3]);
  });

  it('a crossing does not take a slanted line whose bounds it meets but whose line it misses', () => {
    assert.deepEqual(modelElementsInWindow(drawing, { x: 3.5, y: 5 }, { x: 4.5, y: 6 }, true), []);
    assert.deepEqual(modelElementsInWindow(drawing, { x: 2, y: 6 }, { x: 3, y: 8 }, true), [4]);
  });
});
