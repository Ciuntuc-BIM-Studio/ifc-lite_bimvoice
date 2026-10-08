/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDoorSpec, defaultWindowSpec } from '@ifc-lite/create';
import { joineryCatalogueText, parseJoineryCatalogue, readJoinerySpec } from './spec-file';

describe('joinery spec file', () => {
  it('round-trips a catalogue', () => {
    const specs = [{ ...defaultWindowSpec('W'), id: 'a' }, { ...defaultDoorSpec('D'), id: 'b' }];
    assert.deepEqual(parseJoineryCatalogue(joineryCatalogueText(specs)), specs);
  });

  it('fills what is missing from the kind defaults and drops what is wrong', () => {
    const spec = readJoinerySpec({ kind: 'door', name: 'X', width: -1, panels: [{ col: 0, row: 0, operation: 'teleport' }, 'nope'], colors: { frame: 'red' } });
    assert.ok(spec);
    assert.equal(spec.width, defaultDoorSpec().width);
    assert.deepEqual(spec.panels, [{ col: 0, row: 0, operation: 'fixed' }]);
    assert.equal(spec.colors.frame, defaultDoorSpec().colors.frame);
    assert.equal(readJoinerySpec({ name: 'no kind' }), null);
  });

  it('refuses a file that is not a catalogue', () => {
    assert.throws(() => parseJoineryCatalogue('{"format":"other"}'), /Not a joinery catalogue/);
    assert.throws(() => parseJoineryCatalogue('{'), /invalid JSON/);
  });
});
