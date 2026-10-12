/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OPEN_PACKAGE_SUFFIXES, PACKAGE_SUFFIX } from './format';
import { withPackageSuffix } from './file-access';

describe('package file names', () => {
  it('saves as .lapin and still opens the earlier .bvproj', () => {
    assert.equal(PACKAGE_SUFFIX, '.lapin');
    assert.deepEqual([...OPEN_PACKAGE_SUFFIXES], ['.lapin', '.bvproj']);
  });

  it('names a package .lapin: a bare name gets it, an earlier .bvproj is renamed, a .lapin stays', () => {
    assert.equal(withPackageSuffix('House'), 'House.lapin');
    assert.equal(withPackageSuffix('House.bvproj'), 'House.lapin');
    assert.equal(withPackageSuffix('House.lapin'), 'House.lapin');
  });
});
