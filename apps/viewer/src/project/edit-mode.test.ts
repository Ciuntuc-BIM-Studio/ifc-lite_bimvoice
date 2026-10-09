/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** The Design / Infrastructure tools switch Edit mode on by themselves, but never past a read-only role. */

import '@/test/setup-dom.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '@/store';
import { MODEL_ID, seedModelingSession } from '@/test/modeling-session-fixture';
import { mutationDenial } from '@/store/mutation-permission';
import { ensureEditMode } from './edit-mode';

const s = () => useViewerStore.getState();

beforeEach(async () => {
  await seedModelingSession();
  s().exitModelWorkspace();
  s().setEditEnabled(false);
});
afterEach(() => {
  s().exitModelWorkspace();
});

describe('ensureEditMode', () => {
  it('switches Edit mode on when it is the only thing in the way', () => {
    assert.match(mutationDenial(s(), MODEL_ID) ?? '', /Edit mode/);
    assert.equal(ensureEditMode(), true);
    assert.equal(s().editEnabled, true);
    assert.equal(mutationDenial(s(), MODEL_ID), null);
    assert.equal(ensureEditMode(), true, 'and is a no-op once it is on');
  });

  it('does not override a read-only collaboration role', () => {
    const canCollabEdit = s().canCollabEdit;
    useViewerStore.setState({ canCollabEdit: () => false });
    try {
      assert.equal(ensureEditMode(), false);
      assert.equal(s().editEnabled, false);
    } finally {
      useViewerStore.setState({ canCollabEdit });
    }
  });
});
