/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Central document tabs: opening is idempotent, closing the front tab
 * brings its neighbour forward, and the 3D tab can never be closed.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeDocumentTab, MODEL_TAB_ID, pruneDocumentTabs, showDocumentTab, useDocumentTabs } from './document-tabs.js';

beforeEach(() => useDocumentTabs.setState({ openIds: [], activeId: MODEL_TAB_ID }));

describe('document tabs', () => {
  it('opens each view once, in order, and puts it in front', () => {
    showDocumentTab('a');
    showDocumentTab('b');
    showDocumentTab('a');
    assert.deepEqual(useDocumentTabs.getState(), { openIds: ['a', 'b'], activeId: 'a' });
  });

  it('brings the right neighbour forward when the front tab closes, then the left, then 3D', () => {
    ['a', 'b', 'c'].forEach(showDocumentTab);
    showDocumentTab('b');
    assert.equal(closeDocumentTab('b'), 'c');
    assert.equal(closeDocumentTab('c'), 'a');
    assert.equal(closeDocumentTab('a'), MODEL_TAB_ID);
  });

  it('keeps the front tab when a background tab closes', () => {
    ['a', 'b'].forEach(showDocumentTab);
    assert.equal(closeDocumentTab('a'), 'b');
    assert.deepEqual(useDocumentTabs.getState().openIds, ['b']);
  });

  it('never adds or closes the 3D tab', () => {
    showDocumentTab(MODEL_TAB_ID);
    assert.deepEqual(useDocumentTabs.getState().openIds, []);
    assert.equal(closeDocumentTab(MODEL_TAB_ID), MODEL_TAB_ID);
  });

  it('drops tabs of views that no longer exist', () => {
    ['a', 'b'].forEach(showDocumentTab);
    pruneDocumentTabs(new Set(['a']));
    assert.deepEqual(useDocumentTabs.getState(), { openIds: ['a'], activeId: MODEL_TAB_ID });
  });
});
