/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RIBBON_REMOVED_TABS } from '@/store/constants';
import {
  DEFAULT_RIBBON_TABS, defaultRibbonLayout, moveTab, normalizeRibbonLayout, toggleTab, visibleRibbonTabs,
} from './ribbon-layout';

describe('ribbon layout', () => {
  it('leaves ifc-lite\'s Home, Elements, Analyze and Author out of Lapin\'s strip', () => {
    const ids = DEFAULT_RIBBON_TABS.map((t) => t.id);
    for (const id of ['home', 'elements', 'analyze', 'author'] as const) {
      assert.ok(RIBBON_REMOVED_TABS.has(id));
      assert.ok(!ids.includes(id), `${id} is not offered`);
    }
    assert.deepEqual(ids.slice(0, 2), ['file', 'design']);
    // Not even while active: a tour or a command opening one finds no tab for it.
    assert.ok(!visibleRibbonTabs(defaultRibbonLayout(), 'home').some((t) => t.id === 'home'));
  });

  it('a saved layout keeps known tabs once, appends new ones, never hides Design', () => {
    const l = normalizeRibbonLayout({ order: ['view', 'bogus', 'view', 'design', 'home'], hidden: ['design', 'infrastructure', 'author', 'x'] });
    assert.deepEqual(l.order.slice(0, 2), ['view', 'design']);
    assert.ok(!l.order.includes('home'), 'a tab left out of Lapin is dropped from a saved layout');
    assert.equal(l.order.length, defaultRibbonLayout().order.length);
    assert.deepEqual(l.hidden, ['infrastructure']);
    assert.deepEqual(normalizeRibbonLayout('garbage'), defaultRibbonLayout());
  });

  it('moves, hides and shows', () => {
    let l = defaultRibbonLayout();
    l = moveTab(l, 'infrastructure', -100);
    assert.equal(l.order[0], 'infrastructure');
    const at = l.order.indexOf('view');
    l = moveTab(l, 'view', -1);
    assert.equal(l.order.indexOf('view'), at - 1);
    l = toggleTab(l, 'infrastructure', false);
    l = toggleTab(l, 'design', false);
    assert.deepEqual(l.hidden, ['infrastructure']);
    assert.ok(!visibleRibbonTabs(l, 'design').some((t) => t.id === 'infrastructure'));
    // The active tab shows even when hidden, so a tool that opens it is never stranded.
    assert.ok(visibleRibbonTabs(l, 'infrastructure').some((t) => t.id === 'infrastructure'));
    assert.deepEqual(toggleTab(l, 'infrastructure', true).hidden, []);
  });
});
