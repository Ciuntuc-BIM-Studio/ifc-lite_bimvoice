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

  it('returns the first-level islands first, then the islands nested in them (even-odd: filled again)', () => {
    const r = regionAt({ x: 12, y: 12 }, loops);
    assert.ok(r);
    assert.equal(r.length, 4);
    assert.ok(r.slice(1, 3).includes(islandA));
    assert.ok(r.slice(1, 3).includes(islandB));
    assert.equal(r[3], nested);
    assert.ok(!r.includes(outside));
    assert.ok(!r.includes(degenerate));
  });

  it('point in the outer ring sees mid as its island, then everything nested in mid', () => {
    const r = regionAt({ x: 80, y: 80 }, loops);
    assert.ok(r);
    assert.equal(r[0], big);
    assert.equal(r[1], mid);
    assert.ok(r.slice(2).includes(islandA) && r.slice(2).includes(nested));
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

describe('regionAt: repeated outlines and nested islands', () => {
  const sq = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
  it('drops an outline given twice (a closed polyline and the area its segments enclose)', () => {
    const outer = sq(0, 0, 10);
    const hole = sq(4, 4, 2);
    // The same hole again, starting at another corner.
    const again = [hole[2], hole[3], hole[0], hole[1]];
    const region = regionAt({ x: 1, y: 1 }, [outer, hole, outer, again]);
    assert.equal(region?.length, 2, 'the outline and one hole: a repeated hole would cancel under even-odd');
  });

  it('keeps islands inside holes, after the first-level holes', () => {
    const region = regionAt({ x: 1, y: 1 }, [sq(0, 0, 100), sq(10, 10, 40), sq(20, 20, 20), sq(26, 26, 5)]);
    assert.equal(region?.length, 4);
    assert.deepEqual(region?.[1], sq(10, 10, 40), 'the first-level hole first');
  });
});
