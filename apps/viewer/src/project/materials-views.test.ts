/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A material per kind of view: the project's row, then what IFC gives it,
 * then what its name suggests; plans follow sections unless they say
 * otherwise; the row's appearance is what goes back into IFC.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MaterialAppearance } from '@ifc-lite/create';
import { resetProject, useProjectStore } from './project-store';
import { clearMaterialView, materialGraphics, setMaterial, setMaterialView } from './materials';
import { projectMaterialAppearance } from './material-ifc-sync';

const IFC: MaterialAppearance = { color: '#808080', hatches: { section: { pattern: 'CONCRETE', scale: 2, background: '#eeeeee' }, elevation: { lines: { angleDeg: 45, spacing: 0.2 } } } };

beforeEach(() => resetProject());

describe('materials per kind of view', () => {
  it('IFC comes before the name, and a plan falls back to the section', () => {
    const s = materialGraphics('Beton C25', [], 'section', IFC);
    assert.equal(s.source, 'ifc');
    assert.deepEqual([s.hatch, s.hatchScale, s.fill, s.color], ['CONCRETE', 2, '#eeeeee', '#808080']);
    assert.equal(materialGraphics('Beton C25', [], 'plan', IFC).hatch, 'CONCRETE');
    // A line hatching read from a file maps onto a library pattern.
    assert.equal(materialGraphics('Beton C25', [], 'elevation', IFC).hatch, 'LINES45');
    // No IFC: the name; and an elevation draws nothing unless told.
    assert.equal(materialGraphics('Beton C25', [], 'section', null).hatch, 'CONCRETE');
    assert.equal(materialGraphics('Beton C25', [], 'elevation', null).hatch, undefined);
  });

  it('a row taken over keeps what the material showed; a plan of its own overrides, and clears back', () => {
    setMaterial('Brick', { color: '#aa5533' });
    const row = () => useProjectStore.getState().materials!.find((m) => m.name === 'Brick')!;
    assert.equal(row().hatch, 'BRICK');
    setMaterialView('Brick', 'plan', { hatch: 'CROSS' });
    const list = useProjectStore.getState().materials!;
    assert.equal(materialGraphics('Brick', list, 'plan', null).hatch, 'CROSS');
    assert.equal(materialGraphics('Brick', list, 'section', null).hatch, 'BRICK');
    // "The material's colour" is its own colour now.
    assert.equal(materialGraphics('Brick', list, 'section', null).fill, '#aa5533');
    clearMaterialView('Brick', 'plan');
    assert.equal(materialGraphics('Brick', useProjectStore.getState().materials!, 'plan', null).hatch, 'BRICK');
  });

  it('the row\'s appearance is what IFC gets: colour, section and front-view hatches', () => {
    setMaterial('Brick', { color: '#aa5533', hatchScale: 1.5, fill: null });
    setMaterialView('Brick', 'elevation', { hatch: 'BRICK' });
    assert.deepEqual(projectMaterialAppearance('brick'), {
      color: '#aa5533',
      hatches: { section: { pattern: 'BRICK', scale: 1.5 }, elevation: { pattern: 'BRICK' } },
    });
    assert.equal(projectMaterialAppearance('Unknown'), null);
  });
});
