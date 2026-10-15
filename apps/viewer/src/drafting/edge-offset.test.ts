/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { edgeOffsetFor, knifeAt, offsetEdge } from './edge-offset';
import { gripsOf, moveGrip } from './grips';
import type { Pt } from './types';

const P = (x: number, y: number): Pt => ({ x, y });
const near = (got: Pt[], want: [number, number][]) => {
  assert.equal(got.length, want.length, JSON.stringify(got));
  got.forEach((p, i) => { assert.ok(Math.abs(p.x - want[i][0]) < 1e-9 && Math.abs(p.y - want[i][1]) < 1e-9, `${i}: ${JSON.stringify(p)} ≠ ${want[i]}`); });
};

// A 10 × 4 rectangle, counter-clockwise.
const rect = [P(0, 0), P(10, 0), P(10, 4), P(0, 4)];

describe('edge offset', () => {
  it('pushes a side square to itself, its neighbours growing along their own lines', () => {
    // The top side (2: from (10,4) to (0,4)) runs in −x, so its left normal is (0, −1): dragging up is a negative offset.
    const d = edgeOffsetFor(rect, 2, P(5, 7));
    assert.equal(d, -3);
    near(offsetEdge(rect, 2, d, true), [[0, 0], [10, 0], [10, 7], [0, 7]]);
  });

  it('keeps a slanted neighbour on its line', () => {
    const trapezoid = [P(0, 0), P(10, 0), P(8, 4), P(2, 4)];
    // Top side up by 2: its ends slide along the slanted sides (slope 2 : 1).
    near(offsetEdge(trapezoid, 2, -2, true), [[0, 0], [10, 0], [7, 6], [3, 6]]);
  });

  it('after a knife cut moves only the piece dragged, with a step at the cut', () => {
    const cut = knifeAt(rect, P(6, 4.1), true)!;
    near(cut, [[0, 0], [10, 0], [10, 4], [6, 4], [0, 4]]);
    // Drag the right piece of the top (side 2: (10,4) → (6,4)) up by 1.5.
    near(offsetEdge(cut, 2, -1.5, true), [[0, 0], [10, 0], [10, 5.5], [6, 5.5], [6, 4], [0, 4]]);
  });

  it('works on an open polyline: a free end moves square', () => {
    const open = [P(0, 0), P(10, 0), P(10, 5)];
    near(offsetEdge(open, 0, 2, false), [[0, 2], [10, 2], [10, 5]]);
  });

  it('cuts only on a side, not on a vertex', () => {
    assert.equal(knifeAt(rect, P(10, 0.0000000001), true), null);
    assert.equal(knifeAt(rect, P(5, 9), true, 1), null);
  });

  it('gives a drafted polygon a grip on each side that pushes it, only square to it', () => {
    const shape = { type: 'polyline' as const, pts: rect, closed: true };
    const grips = gripsOf('r', shape).filter((g) => g.key.startsWith('edge'));
    assert.equal(grips.length, 4);
    // The right side's grip dragged up and out: only the outward part counts.
    const moved = moveGrip(shape, 'edge1', P(13, 9));
    assert.equal(moved.type, 'polyline');
    near((moved as typeof shape).pts, [[0, 0], [13, 0], [13, 4], [0, 4]]);
  });
});
