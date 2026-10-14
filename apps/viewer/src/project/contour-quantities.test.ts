/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { contourMeasures, extrusionQuantities } from './contour-quantities';

const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const value = (q: ReturnType<typeof extrusionQuantities>, name: string) => q.values.find((v) => v.name === name)?.value;

describe('contour measures and base quantities', () => {
  it('measure a contour with its holes: gross, net, perimeters', () => {
    const m = contourMeasures([sq(0, 0, 10), sq(2, 2, 2), sq(6, 6, 1)]);
    assert.equal(m.grossArea, 100);
    assert.equal(m.netArea, 95);
    assert.equal(m.outerPerimeter, 40);
    assert.equal(m.perimeter, 52);
    assert.equal(m.holes, 2);
  });

  it('give a slab its standard set, volumes from the net area', () => {
    const q = extrusionQuantities('IfcSlab', true, contourMeasures([sq(0, 0, 10), sq(2, 2, 2)]), -0.2);
    assert.equal(q.set, 'Qto_SlabBaseQuantities');
    assert.equal(value(q, 'Width'), 0.2);
    assert.equal(value(q, 'NetArea'), 96);
    assert.ok(Math.abs(value(q, 'NetVolume')! - 19.2) < 1e-9);
    assert.ok(Math.abs(value(q, 'GrossVolume')! - 20) < 1e-9);
  });

  it('name a wall\'s areas by the view it was drawn in', () => {
    const m = contourMeasures([sq(0, 0, 4)]);
    assert.ok(extrusionQuantities('IfcWall', true, m, 3).values.some((v) => v.name === 'NetFootprintArea'));
    assert.ok(extrusionQuantities('IfcWall', false, m, 0.3).values.some((v) => v.name === 'NetSideArea'));
  });

  it('fall back to Lapin\'s own set for a class without a fitting standard one', () => {
    const q = extrusionQuantities('IfcFurnishingElement', true, contourMeasures([sq(0, 0, 1)]), 0.5);
    assert.equal(q.set, 'IfcLite_ExtrusionQuantities');
    assert.equal(value(q, 'NetVolume'), 0.5);
  });
});
