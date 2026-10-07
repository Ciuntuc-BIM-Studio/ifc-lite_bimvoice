/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation geometry: dimension values and line placement, level labels,
 * transforms that keep text readable, and picking inside hatches.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionLayout, entityBounds, formatLevel, mirrorEntity, nearestOnEntity, rotateEntity, translateEntity } from './annotation.js';
import type { AnnotationShape } from './types.js';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('dimensionLayout', () => {
  it('measures an aligned dimension and puts its line through the picked offset', () => {
    const layout = dimensionLayout({ type: 'dimension', variant: 'aligned', a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, at: { x: -4, y: 3 }, height: 0.25 });
    assert.equal(layout.label, '5.00');
    const dimLine = layout.lines[2];
    // The dimension line is parallel to a→b, offset by 5 along the normal (-0.8, 0.6).
    near(dimLine.a.x, -4); near(dimLine.a.y, 3);
    near(dimLine.b.x, -1); near(dimLine.b.y, 7);
  });

  it('a linear dimension measures horizontally or vertically depending on where it is pulled', () => {
    const base = { type: 'dimension' as const, variant: 'linear' as const, a: { x: 0, y: 0 }, b: { x: 3, y: 4 }, height: 0.25 };
    assert.equal(dimensionLayout({ ...base, at: { x: 1.5, y: 8 } }).label, '3.00');
    assert.equal(dimensionLayout({ ...base, at: { x: 9, y: 2 } }).label, '4.00');
  });

  it('labels radius / diameter and angles', () => {
    assert.equal(dimensionLayout({ type: 'radial', c: { x: 0, y: 0 }, r: 1.5, at: { x: 3, y: 0 }, diameter: false, height: 0.2 }).label, 'R 1.50');
    assert.equal(dimensionLayout({ type: 'radial', c: { x: 0, y: 0 }, r: 1.5, at: { x: 3, y: 0 }, diameter: true, height: 0.2 }).label, 'Ø 3.00');
    assert.equal(dimensionLayout({ type: 'angular', c: { x: 0, y: 0 }, a: { x: 1, y: 0 }, b: { x: 0, y: 1 }, at: { x: 1, y: 1 }, height: 0.2 }).label, '90.0°');
  });

  it('honours a text override', () => {
    assert.equal(dimensionLayout({ type: 'dimension', variant: 'aligned', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, at: { x: 0, y: 1 }, height: 0.2, text: 'EQ' }).label, 'EQ');
  });
});

describe('formatLevel', () => {
  it('signs levels the architectural way', () => {
    assert.equal(formatLevel(0), '±0.00');
    assert.equal(formatLevel(3.06), '+3.06');
    assert.equal(formatLevel(-3.98), '−3.98');
  });
});

describe('entity transforms', () => {
  const text: AnnotationShape = { type: 'text', p: { x: 1, y: 1 }, text: 'A', height: 0.25, rotation: 0 };

  it('moves every annotation point', () => {
    const moved = translateEntity({ type: 'dimension', variant: 'aligned', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, at: { x: 0, y: 1 }, height: 0.2 }, { x: 2, y: 3 });
    assert.equal(moved.type, 'dimension');
    if (moved.type === 'dimension') assert.deepEqual([moved.a, moved.b, moved.at], [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 2, y: 4 }]);
  });

  it('rotating text turns its baseline; mirroring keeps it readable', () => {
    const rotated = rotateEntity(text, { x: 0, y: 0 }, Math.PI / 2);
    assert.ok(rotated.type === 'text');
    if (rotated.type === 'text') { near(rotated.p.x, -1); near(rotated.p.y, 1); near(rotated.rotation, Math.PI / 2); }
    const mirrored = mirrorEntity(text, { x: 0, y: 0 }, { x: 0, y: 1 });
    if (mirrored.type === 'text') { near(mirrored.p.x, -1); near(mirrored.rotation, 0); }
  });
});

describe('picking annotations', () => {
  it('a click inside a hatch hits it; bounds cover its loops', () => {
    const hatch: AnnotationShape = { type: 'hatch', loops: [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]], pattern: 'LINES45', scale: 1, angle: 0 };
    assert.equal(nearestOnEntity(hatch, { x: 2, y: 1 }).dist, 0);
    assert.ok(nearestOnEntity(hatch, { x: 6, y: 1 }).dist > 1.9);
    assert.deepEqual(entityBounds(hatch), { min: { x: 0, y: 0 }, max: { x: 4, y: 3 } });
  });
});
