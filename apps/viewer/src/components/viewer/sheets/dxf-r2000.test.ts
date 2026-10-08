/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aciOf, DxfR2000, dxfLineWeight } from './dxf-r2000';

const read = (w: DxfR2000) => new TextDecoder('windows-1252').decode(w.bytes('test'));

describe('DxfR2000', () => {
  it('maps colours and pen widths to DXF values', () => {
    assert.equal(aciOf('#000000'), 7);
    assert.equal(aciOf('rgb(224, 80, 80)'), 1);
    assert.equal(dxfLineWeight(0.25), 25);
    assert.equal(dxfLineWeight(0.7), 70);
    assert.equal(dxfLineWeight(0.33), 35);
  });

  it('writes layers with colour, line type and weight, entities BYLAYER, and a handle seed above every handle', () => {
    const w = new DxfR2000(100);
    const walls = w.layer('A-WALL dims', { color: '#e05050', lineType: 'dashed', lineWeight: 0.5 });
    w.line({ x: 0, y: 0 }, { x: 1, y: 0 }, walls, { color: '#e05050', lineType: 'dashed', lineWeight: 0.5 });
    w.polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], walls, { color: '#0000ff', lineType: 'dashed', lineWeight: 0.5 }, true);
    w.text({ x: 0, y: 0 }, 'Note', 2.5, walls);
    const text = read(w);
    assert.match(text, /\$ACADVER\n\s*1\nAC1015/);
    assert.match(text, /\n\s*2\nA-WALL dims\n\s*70\n0\n\s*62\n1\n420\n14700624\n\s*6\nDASHED\n370\n50\n/);
    assert.match(text, /\n\s*2\nDASHED\n[\s\S]*?\n\s*49\n300\n/, 'dashes scaled to the view');
    assert.match(text, /LINE\n[\s\S]*?\n\s*8\nA-WALL dims\n100\nAcDbLine/, 'the line takes everything BYLAYER');
    assert.match(text, /LWPOLYLINE\n[\s\S]*?\n\s*8\nA-WALL dims\n\s*62\n5\n/, 'the blue polyline carries its own colour');
    const body = text.slice(text.indexOf('ENDSEC'));
    const handles = [...body.matchAll(/\n {2}5\n([0-9A-F]+)\n/g)].map((m) => parseInt(m[1], 16));
    const seed = parseInt(/\$HANDSEED\n\s*5\n([0-9A-F]+)/.exec(text)?.[1] ?? '0', 16);
    assert.ok(handles.length > 10 && handles.every((h) => h < seed), 'the handle seed is above every handle');
    assert.equal(new Set(handles).size, handles.length, 'handles are unique');
  });
});
