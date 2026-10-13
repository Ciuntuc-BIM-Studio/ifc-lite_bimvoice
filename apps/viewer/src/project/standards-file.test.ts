/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AXIS_STYLE } from '@/drafting/styles';
import { readStandards } from './standards-file';

describe('axis types in a project file', () => {
  it('reads them tolerantly and always keeps Standard', () => {
    const { axisStyles } = readStandards({
      axisStyles: [
        { id: 'grid', name: 'Grid', textStyle: 'big', bubble: 'square', ends: 'start', size: 12, lineType: 'dashed', color: '#ff0000', firstLabel: 'A' },
        { id: 'odd', bubble: 'hexagon', ends: 'middle', size: -3, lineType: 'zigzag', color: 'red', firstLabel: '  ' },
        'not an object',
      ],
    });
    assert.deepEqual(axisStyles.map((a) => a.id), ['standard', 'grid', 'odd']);
    assert.deepEqual(axisStyles[1], { id: 'grid', name: 'Grid', textStyle: 'big', bubble: 'square', ends: 'start', size: 12, lineType: 'dashed', color: '#ff0000', firstLabel: 'A' });
    const odd = axisStyles[2];
    assert.deepEqual([odd.bubble, odd.ends, odd.size, odd.lineType, odd.firstLabel, odd.color], ['circle', 'both', DEFAULT_AXIS_STYLE.size, 'dashdot', '1', undefined]);
  });

  it('gives an older file without axis types the Standard one', () => {
    assert.deepEqual(readStandards({}).axisStyles, [DEFAULT_AXIS_STYLE]);
  });
});

describe('default axis type and tag types in a project file', () => {
  it('reads the default, falling back to Standard when the type is gone', () => {
    const axisStyles = [{ id: 'grid', name: 'Grid' }];
    assert.equal(readStandards({ axisStyles, defaultAxisStyle: 'grid' }).defaultAxisStyle, 'grid');
    assert.equal(readStandards({ axisStyles, defaultAxisStyle: 'gone' }).defaultAxisStyle, 'standard');
    assert.equal(readStandards({}).defaultAxisStyle, 'standard');
  });

  it('reads tag types tolerantly', () => {
    const { tagTypes } = readStandards({
      tagTypes: [
        { id: 't1', name: 'Wall', template: '{Name} {Pset_WallCommon.FireRating}', classes: ['IfcWall', 3, ' '] },
        { id: 't2', template: '{Tag}' },
        { name: 'no id', template: '{Tag}' },
        { id: 't3', name: 'no template' },
      ],
    });
    assert.deepEqual(tagTypes, [
      { id: 't1', name: 'Wall', template: '{Name} {Pset_WallCommon.FireRating}', classes: ['IfcWall'] },
      { id: 't2', name: 'Tag', template: '{Tag}', classes: [] },
    ]);
  });
});
