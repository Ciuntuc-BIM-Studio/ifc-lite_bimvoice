/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Read-out quantities of drafted shapes, and typed parameter values. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureShape, parseParamValue } from './measure.js';

const near = (a: number | undefined, b: number) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

describe('measureShape', () => {
  it('measures lines, closed polylines, circles and arcs', () => {
    near(measureShape({ type: 'line', a: { x: 0, y: 0 }, b: { x: 3, y: 4 } }).length, 5);
    const rect = measureShape({ type: 'polyline', pts: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }], closed: true });
    near(rect.length, 10);
    near(rect.area, 6);
    near(measureShape({ type: 'circle', c: { x: 0, y: 0 }, r: 1 }).area, Math.PI);
    const arc = measureShape({ type: 'arc', c: { x: 0, y: 0 }, r: 2, start: 0, end: Math.PI / 2 });
    near(arc.length, Math.PI);
    near(arc.angleDeg, 90);
  });
});

describe('parseParamValue', () => {
  it('reads numbers and booleans, else keeps the text', () => {
    assert.equal(parseParamValue('2.7'), 2.7);
    assert.equal(parseParamValue('true'), true);
    assert.equal(parseParamValue('IfcWall'), 'IfcWall');
    assert.equal(parseParamValue(''), '');
  });
});
