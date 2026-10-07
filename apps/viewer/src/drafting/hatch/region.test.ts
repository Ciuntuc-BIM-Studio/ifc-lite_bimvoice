/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Pt } from '../types.js';
import { loopArea, regionAt } from './region.js';

function sq(x: number, y: number, size: number, cw = false): Pt[] {
  const pts = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return cw ? pts.reverse() : pts;
}

describe('regionAt', () => {
  const big = sq(0, 0, 100);
  const mid = sq(10, 10, 50, true);
  const islandA = sq(20, 20, 10);
  const nested = sq(22, 22, 4); // inside islandA: second level
  const islandB = sq(40, 40, 10, true);
  const outside = sq(200, 200, 5);
  const degenerate = [{ x: 15, y: 15 }, { x: 16, y: 16 }, { x: 17, y: 17 }];
  const loops = [big, mid, islandA, nested, islandB, outside, degenerate];

  it('loopArea is winding independent', () => {
    assert.equal(loopArea(sq(0, 0, 3)), 9);
    assert.equal(loopArea(sq(0, 0, 3, true)), 9);
  });

  it('picks the smallest containing loop as outer', () => {
    const r = regionAt({ x: 12, y: 12 }, loops);
    assert.ok(r);
    assert.equal(r[0], mid);
  });

  it('returns first-level islands only', () => {
    const r = regionAt({ x: 12, y: 12 }, loops);
    assert.ok(r);
    assert.equal(r.length, 3);
    assert.ok(r.includes(islandA));
    assert.ok(r.includes(islandB));
    assert.ok(!r.includes(nested));
    assert.ok(!r.includes(outside));
    assert.ok(!r.includes(degenerate));
  });

  it('point in the outer ring sees mid as its only island', () => {
    const r = regionAt({ x: 80, y: 80 }, loops);
    assert.ok(r);
    assert.equal(r[0], big);
    assert.deepEqual(r.slice(1), [mid]);
  });

  it('point inside an island selects the island itself', () => {
    const r = regionAt({ x: 21, y: 21 }, loops);
    assert.ok(r);
    assert.equal(r[0], islandA);
    assert.deepEqual(r.slice(1), [nested]);
  });

  it('returns null when nothing contains the point', () => {
    assert.equal(regionAt({ x: -5, y: -5 }, loops), null);
    assert.equal(regionAt({ x: 1, y: 1 }, []), null);
  });

  it('accepts an island touching the outer boundary', () => {
    const touching = sq(0, 0, 5);
    const r = regionAt({ x: 50, y: 50 }, [sq(0, 0, 100), touching]);
    assert.ok(r);
    assert.deepEqual(r.slice(1), [touching]);
  });
});
