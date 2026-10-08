/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aciOf, DxfR12 } from './dxf-r12';

describe('DxfR12', () => {
  it('maps CSS colours to the nearest ACI colour', () => {
    assert.equal(aciOf('#000000'), 7);
    assert.equal(aciOf('rgb(224, 80, 80)'), 1);
    assert.equal(aciOf('#0063b1'), 5);
  });

  it('writes layers, lines, polylines and text as an R12 document', () => {
    const w = new DxfR12();
    const cut = w.layer('cut', '#000');
    w.line({ x: 0, y: 0 }, { x: 10, y: 0 }, cut);
    w.polyline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], w.layer('hatch', '#ff0000'));
    w.text({ x: 5, y: 5 }, 'A-101 Plan', 3.5, w.layer('title block', '#000'), { align: 'center' });
    const text = new TextDecoder('windows-1252').decode(w.bytes('units: mm'));
    assert.match(text, /\$ACADVER\n1\nAC1009/);
    for (const layer of ['CUT', 'HATCH', 'TITLE_BLOCK']) assert.match(text, new RegExp(`\\nLAYER\\n2\\n${layer}\\n`));
    assert.equal(text.match(/\nVERTEX\n/g)?.length, 3);
    assert.match(text, /\nTEXT\n8\nTITLE_BLOCK\n[\s\S]*\n1\nA-101 Plan\n[\s\S]*\n72\n1\n/);
    assert.ok(text.endsWith('EOF\n'));
  });
});
