/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDoorSpec, defaultWindowSpec, type JoinerySpec } from '@ifc-lite/create';
import { elevationSymbol, openingMarks, planSymbol, sectionSymbol, strokeBounds } from './symbols';

const R = { x0: 0, x1: 1, z0: 0, z1: 2 };

describe('opening marks (DIN / SR: lines meet at the hinges)', () => {
  it('points a side-hung sash at its hinge side', () => {
    const [left] = openingMarks('side-left', R, false);
    assert.deepEqual(left.pts[1], { x: 0, y: 1 });
    const [right] = openingMarks('side-right', R, false);
    assert.deepEqual(right.pts[1], { x: 1, y: 1 });
  });

  it('draws tilt-and-turn as two triangles and bottom-hung pointing down', () => {
    const marks = openingMarks('tilt-turn-left', R, false);
    assert.equal(marks.length, 2);
    assert.deepEqual(marks[1].pts[1], { x: 0.5, y: 0 });
    assert.deepEqual(openingMarks('top-hung', R, false)[0].pts[1], { x: 0.5, y: 2 });
  });

  it('draws nothing for fixed glazing and an arrow for sliding', () => {
    assert.deepEqual(openingMarks('fixed', R, false), []);
    const [shaft] = openingMarks('sliding-left', R, false);
    assert.ok(shaft.pts[1].x < shaft.pts[0].x);
  });

  it('dashes the marks seen from the side the panel opens away from', () => {
    const exterior = elevationSymbol(defaultWindowSpec(), { side: 'exterior' });
    assert.ok(exterior.some((s) => s.dashed));
    assert.ok(!elevationSymbol(defaultWindowSpec()).some((s) => s.dashed));
  });

  it('mirrors the exterior elevation', () => {
    const inside = elevationSymbol(defaultWindowSpec());
    const outside = elevationSymbol(defaultWindowSpec(), { side: 'exterior' });
    const apex = (strokes: typeof inside) => strokes.filter((s) => s.pts.length === 3)[0].pts[1].x;
    assert.ok(Math.abs(apex(inside) + apex(outside)) < 1e-9);
  });
});

describe('plan symbol', () => {
  it('opens a door leaf 90° to the interior with its swing arc, the size of the leaf', () => {
    const spec = defaultDoorSpec();
    const strokes = planSymbol(spec);
    const b = strokeBounds(strokes);
    const leafWidth = spec.width - 2 * spec.frame.width;
    // The swing reaches a leaf width into the interior (−y) from the frame's interior face.
    assert.ok(Math.abs(b.min.y - (spec.frame.offset - spec.frame.depth / 2 - leafWidth)) < 1e-6);
    // Jambs cut heavy.
    assert.equal(strokes.filter((s) => s.weight === 'cut').length >= 2, true);
  });

  it('cuts a window through frame, mullion and sashes and shows its boards', () => {
    const spec = defaultWindowSpec();
    const strokes = planSymbol(spec);
    const cut = strokes.filter((s) => s.weight === 'cut');
    // Two jambs + mullion + 2 sash stiles per sash (2 sashes).
    assert.ok(cut.length >= 7);
    assert.equal(strokes.filter((s) => s.weight === 'thin').length, 2);
    assert.equal(strokes.filter((s) => s.weight === 'outline').length, 2);
  });

  it('cuts only the row the plan passes through', () => {
    const spec: JoinerySpec = { ...defaultWindowSpec(), rows: [3, 1], panels: [{ col: 0, row: 1, colSpan: 2, operation: 'fixed' }] };
    const low = planSymbol(spec, { cutZ: 0.3 });
    const high = planSymbol(spec, { cutZ: 1.4 });
    assert.notEqual(low.length, high.length);
  });
});

describe('section symbol', () => {
  it('cuts head, sill, sash rails and glass', () => {
    const spec = defaultWindowSpec();
    const strokes = sectionSymbol(spec);
    const b = strokeBounds(strokes);
    assert.ok(Math.abs(b.max.y - spec.height) < 1e-9);
    assert.ok(b.min.x < spec.frame.offset - spec.frame.depth / 2 - 0.1);
    assert.equal(strokes.filter((s) => s.weight === 'thin').length, 1);
  });
});
