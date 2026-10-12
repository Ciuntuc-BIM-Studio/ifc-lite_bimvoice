/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultRibbonLayout, moveTab, normalizeRibbonLayout, toggleTab, visibleRibbonTabs,
} from './ribbon-layout';

describe('ribbon layout', () => {
  it('a saved layout keeps known tabs once, appends new ones, never hides Home', () => {
    const l = normalizeRibbonLayout({ order: ['view', 'bogus', 'view', 'home'], hidden: ['home', 'author', 'x'] });
    assert.deepEqual(l.order.slice(0, 2), ['view', 'home']);
    assert.equal(l.order.length, defaultRibbonLayout().order.length);
    assert.deepEqual(l.hidden, ['author']);
    assert.deepEqual(normalizeRibbonLayout('garbage'), defaultRibbonLayout());
  });

  it('moves, hides and shows', () => {
    let l = defaultRibbonLayout();
    l = moveTab(l, 'infrastructure', -100);
    assert.equal(l.order[0], 'infrastructure');
    l = moveTab(l, 'view', -3);
    assert.deepEqual(l.order.slice(0, 4), ['infrastructure', 'file', 'view', 'home']);
    l = toggleTab(l, 'author', false);
    l = toggleTab(l, 'home', false);
    assert.deepEqual(l.hidden, ['author']);
    assert.ok(!visibleRibbonTabs(l, 'home').some((t) => t.id === 'author'));
    // The active tab shows even when hidden, so a tool that opens it is never stranded.
    assert.ok(visibleRibbonTabs(l, 'author').some((t) => t.id === 'author'));
    assert.deepEqual(toggleTab(l, 'author', true).hidden, []);
  });
});
