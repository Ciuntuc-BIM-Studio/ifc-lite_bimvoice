/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DIM_STYLE, DEFAULT_TEXT_STYLE, formatDimension, layerShows, readableDeg, resolveDim, resolveText } from './styles';
import { gripsOf, moveGrip } from './grips';
import type { DraftLayer } from './types';

const book = {
  textStyles: [DEFAULT_TEXT_STYLE, { ...DEFAULT_TEXT_STYLE, id: 'big', name: 'Big', height: 5, bold: true }],
  dimStyles: [DEFAULT_DIM_STYLE, { ...DEFAULT_DIM_STYLE, id: 'arch', name: 'Arch', textStyle: 'big', unit: 'mm' as const, precision: 0 }],
};

describe('readability', () => {
  it('folds every direction to read left to right, and bottom to top when vertical', () => {
    assert.equal(readableDeg(0), 0);
    assert.equal(readableDeg(180), 0);
    assert.equal(readableDeg(90), -90, 'a line running down the screen reads bottom to top');
    assert.equal(readableDeg(-90), -90);
    assert.equal(readableDeg(135), -45);
    assert.equal(readableDeg(-135), 45);
  });
});

describe('styles and overrides', () => {
  it('takes the style, then the element\'s overrides', () => {
    assert.equal(resolveText(book, {}).height, 2.5);
    assert.equal(resolveText(book, { textStyle: 'big' }).bold, true);
    assert.equal(resolveText(book, { textStyle: 'big', 'o.bold': false }).bold, false);
    // A dimension's text follows its dimension style's text style.
    assert.equal(resolveText(book, { dimStyle: 'arch' }).height, 5);
    assert.equal(resolveDim(book, { dimStyle: 'arch', 'o.placement': 'below' }).placement, 'below');
    assert.equal(resolveDim(book, { dimStyle: 'gone' }).id, 'standard');
  });

  it('formats in the style\'s unit and precision', () => {
    assert.equal(formatDimension(3.2456, { unit: 'm', precision: 2 }), '3.25');
    assert.equal(formatDimension(3.2456, { unit: 'mm', precision: 0 }), '3246');
    assert.equal(formatDimension(3.2456, { unit: 'cm', precision: 1 }), '324.6');
  });
});

describe('layer visibility', () => {
  const layer: DraftLayer = { id: 'a', name: 'A', color: '#000000', visible: true, locked: false, group: 'g' };
  it('needs the layer, its group, its view and its viewport all to show it', () => {
    assert.equal(layerShows(layer, [{ id: 'g', name: 'G', visible: true, locked: false }]), true);
    assert.equal(layerShows(layer, [{ id: 'g', name: 'G', visible: false, locked: false }]), false);
    assert.equal(layerShows({ ...layer, visible: false }, []), false);
    assert.equal(layerShows(layer, [], { view: ['a'] }), false);
    assert.equal(layerShows(layer, [], { viewport: ['a'] }), false);
    assert.equal(layerShows(layer, [], { view: ['b'], viewport: [] }), true);
  });
});

describe('grips', () => {
  const dim = { type: 'dimension' as const, variant: 'aligned' as const, a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, at: { x: 2, y: 1 }, height: 0.25 };
  it('moves a dimension\'s value on its own, and its line with the value', () => {
    assert.deepEqual(gripsOf('d', dim).map((g) => g.key), ['a', 'b', 'at', 'text']);
    const moved = moveGrip(dim, 'text', { x: 3, y: 2 });
    assert.ok(moved.type === 'dimension' && moved.textAt?.x === 3);
    const line = moveGrip(moved, 'at', { x: 2, y: 2 });
    assert.ok(line.type === 'dimension' && line.textAt?.y === 3, 'the value keeps its place relative to the line');
  });
});
