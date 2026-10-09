/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { triangulateWithHoles } from './triangulate.js';
import { PRESET_IDS, profileArea, profileFromPreset } from './structure-profile.js';

type V2 = [number, number];
const covered = (outer: V2[], holes: V2[][]) => {
  const pts = [...outer, ...holes.flat()];
  return triangulateWithHoles(outer, holes).reduce((s, [a, b, c]) => {
    const A = pts[a], B = pts[b], C = pts[c];
    const area = ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2;
    expect(area).toBeGreaterThan(0);
    return s + area;
  }, 0);
};

describe('triangulateWithHoles', () => {
  it('covers a square with a hole, and a concave outline, exactly', () => {
    expect(covered([[0, 0], [4, 0], [4, 4], [0, 4]], [[[1, 1], [1, 3], [3, 3], [3, 1]]])).toBeCloseTo(12, 9);
    expect(covered([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], [])).toBeCloseTo(7, 9);
    // Two holes, either orientation.
    expect(covered([[0, 0], [10, 0], [10, 4], [0, 4]], [[[1, 1], [3, 1], [3, 3], [1, 3]], [[6, 1], [6, 3], [8, 3], [8, 1]]])).toBeCloseTo(32, 9);
  });

  it('covers every preset profile, holes included (the arch tunnel)', () => {
    for (const id of PRESET_IDS) {
      const p = profileFromPreset(id, id);
      expect(covered(p.outer, p.holes), id).toBeCloseTo(profileArea(p), 6);
    }
  });
});
