/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GraphicOverrideEngine, type Drawing2D } from '@ifc-lite/drawing-2d';
import { cutHatches, DEFAULT_VIEW_PRESET, styledDrawing, viewOverrideRules } from './view-graphics';

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
const drawing = {
  cutPolygons: [
    { entityId: 1, ifcType: 'IfcWall', polygon: { outer: square, holes: [] } },
    { entityId: 2, ifcType: 'IfcDoor', polygon: { outer: square, holes: [] } },
  ],
  lines: [{ entityId: 2, ifcType: 'IfcDoor' }, { entityId: 3, ifcType: 'IfcSlab' }],
} as unknown as Drawing2D;

describe('view graphics', () => {
  it('takes the rules of the view\'s preset; the default one (IFC materials) and none have none', () => {
    assert.equal(DEFAULT_VIEW_PRESET, 'preset-3d-colors');
    assert.equal(viewOverrideRules(undefined).length, 0);
    assert.equal(viewOverrideRules({ presetId: null }).length, 0);
    assert.ok(viewOverrideRules({ presetId: 'preset-architectural' }).length > 0);
  });

  it('adds a winning rule per overridden category', () => {
    const rules = viewOverrideRules({ presetId: null, categories: { walls: { lineColor: '#ff0000', lineWeight: 'heavy' } } });
    const engine = new GraphicOverrideEngine(rules);
    const wall = engine.applyOverrides({ expressId: 1, ifcType: 'IfcWall' });
    const slab = engine.applyOverrides({ expressId: 3, ifcType: 'IfcSlab' });
    assert.equal(wall.style.strokeColor.toLowerCase(), '#ff0000');
    assert.ok(wall.style.lineWeight > slab.style.lineWeight);
  });

  it('hides categories and stamps cut fills, leaving the drawing alone otherwise', () => {
    assert.equal(styledDrawing(drawing, { presetId: null }), drawing);
    const shown = styledDrawing(drawing, { categories: { doors: { visible: false }, walls: { fillColor: '#00ff00' } } });
    assert.deepEqual(shown.cutPolygons.map((p) => p.ifcType), ['IfcWall']);
    assert.deepEqual(shown.cutPolygons[0].color, [0, 1, 0, 1]);
    assert.deepEqual(shown.lines.map((l) => l.ifcType), ['IfcSlab']);
  });

  it('gives a layer part its host\'s category', () => {
    const parts = { ...drawing, cutPolygons: [{ entityId: 9, ifcType: 'IfcBuildingElementPart', polygon: { outer: square, holes: [] } }] } as unknown as Drawing2D;
    const shown = styledDrawing(parts, { categories: { walls: { fillColor: '#0000ff' } } }, (id) => (id === 9 ? 'IfcWall' : null));
    assert.equal(shown.cutPolygons[0].ifcType, 'IfcWall');
    assert.deepEqual(shown.cutPolygons[0].color, [0, 0, 1, 1]);
  });

  it('lists the cut faces to hatch, in the category line colour', () => {
    const hatches = cutHatches(drawing, { categories: { walls: { cutHatch: 'ANSI31', lineColor: '#123456', hatchScale: 2 } } });
    assert.equal(hatches.length, 1);
    assert.deepEqual([hatches[0].pattern, hatches[0].scale, hatches[0].color], ['ANSI31', 2, '#123456']);
  });
});
