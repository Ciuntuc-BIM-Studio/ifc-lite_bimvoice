/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONCRETE, DEFAULT_STRIP_FOUNDATION } from '@ifc-lite/create';
import { stripOutlines } from './foundation-place.js';

const type = { typeId: 't', name: 'SF', ...DEFAULT_STRIP_FOUNDATION, concrete: DEFAULT_CONCRETE };
const near = (a: readonly (readonly number[])[], b: readonly (readonly number[])[]) =>
  a.forEach((p, i) => p.forEach((v, k) => assert.ok(Math.abs(v - b[i][k]) < 1e-9, `${i}.${k}: ${v} ≠ ${b[i][k]}`)));

describe('strip foundation outlines', () => {
  it('put the core on the drawn axis, the outer layers on its right, the footing centred under it', () => {
    const o = stripOutlines(type, [0, 0], [5, 0], false, false);
    near(o.stem, [[0, -0.275], [5, -0.275], [5, 0.15], [0, 0.15]]);
    near(o.footing, [[0, -0.3], [5, -0.3], [5, 0.3], [0, 0.3]]);
  });

  it('run the footing on past a chained end by half its width', () => {
    const o = stripOutlines(type, [0, 0], [0, 4], true, false);
    near(o.footing, [[0.3, -0.3], [0.3, 4], [-0.3, 4], [-0.3, -0.3]]);
  });
});
