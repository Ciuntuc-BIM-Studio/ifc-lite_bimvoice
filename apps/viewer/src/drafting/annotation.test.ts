/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation geometry: dimension values and line placement, level labels,
 * transforms that keep text readable, and picking inside hatches.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { axisLayout, dimensionLayout, entityBounds, entitySkeleton, formatLevel, mirrorEntity, nearestOnEntity, nextAxisLabel, rotateEntity, translateEntity } from './annotation.js';
import { gripsOf, moveGrip } from './grips.js';
import { readDraft } from './draft-file.js';
import type { AnnotationShape, AxisShape } from './types.js';

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

describe('grid axes', () => {
  const axis: AxisShape = { type: 'axis', a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, label: 'A', bubble: 'circle', ends: 'both', size: 1, height: 0.25, lineType: 'dashdot' };

  it('counts labels on: numbers, letters, mixed', () => {
    assert.deepEqual(['1', '9', '09', 'A', 'Z', 'AZ', 'b', "A'", 'A1', 'X'].map(nextAxisLabel), ['2', '10', '10', 'B', 'AA', 'BA', 'c', "B'", 'A2', 'Y']);
  });

  it('puts the bubbles just past the chosen ends, wide enough for the label', () => {
    const both = axisLayout(axis);
    near(both.r, 0.5);
    assert.deepEqual(both.bubbles, [{ x: -0.5, y: 0 }, { x: 10.5, y: 0 }]);
    assert.deepEqual(axisLayout({ ...axis, ends: 'end' }).bubbles, [{ x: 10.5, y: 0 }]);
    assert.equal(axisLayout({ ...axis, ends: 'none' }).bubbles.length, 0);
    // A long label widens the bubble past its size.
    assert.ok(axisLayout({ ...axis, label: 'A-12.3' }).r > 0.5);
  });

  it('is picked by its line and its bubbles, and bounded by them', () => {
    const parts = entitySkeleton(axis);
    assert.deepEqual(parts.map((p) => p.type), ['line', 'circle', 'circle']);
    assert.deepEqual(entitySkeleton({ ...axis, bubble: 'square', ends: 'start' }).map((p) => p.type), ['line', 'polyline']);
    const b = entityBounds(axis);
    near(b.min.x, -1); near(b.max.x, 11); near(b.min.y, -0.5); near(b.max.y, 0.5);
    near(nearestOnEntity(axis, { x: 5, y: 0.1 }).dist, 0.1);
  });

  it('moves by its end grips and transforms with its label upright', () => {
    assert.deepEqual(gripsOf('g', axis).map((g) => g.key), ['a', 'b']);
    const moved = moveGrip(axis, 'b', { x: 0, y: 8 });
    assert.ok(moved.type === 'axis' && moved.b.y === 8 && moved.label === 'A');
    const t = translateEntity(axis, { x: 1, y: 2 });
    assert.ok(t.type === 'axis' && t.a.x === 1 && t.b.y === 2);
    const m = mirrorEntity(axis, { x: 0, y: 0 }, { x: 0, y: 1 });
    assert.ok(m.type === 'axis');
    near(m.b.x, -10);
  });

  it('reads back from a project file, with defaults for what an older file lacks', () => {
    const entity = { id: 'e', viewId: 'v', layerId: '0', params: {}, shape: axis };
    assert.deepEqual(readDraft(JSON.parse(JSON.stringify(entity)), 'drafts/0').shape, axis);
    const bare = readDraft({ ...entity, shape: { type: 'axis', a: axis.a, b: axis.b, label: '3', height: 0.25 } }, 'drafts/0').shape;
    assert.deepEqual(bare, { ...axis, label: '3' });
  });
});
