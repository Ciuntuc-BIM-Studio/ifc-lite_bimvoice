/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arrangementLoops, selfIntersects, type Segment } from './arrangement';
import type { Pt } from './types';

const P = (x: number, y: number): Pt => ({ x, y });
const area = (l: Pt[]) => l.reduce((s, p, i) => s + p.x * l[(i + 1) % l.length].y - l[(i + 1) % l.length].x * p.y, 0) / 2;
const areas = (loops: Pt[][]) => loops.map(area).map((a) => Math.round(a * 1000) / 1000).sort((a, b) => a - b);

describe('arrangementLoops', () => {
  it('closes four separate lines into one counter-clockwise square', () => {
    const segs: Segment[] = [[P(0, 0), P(4, 0)], [P(4, 0), P(4, 3)], [P(4, 3), P(0, 3)], [P(0, 0), P(0, 3)]];
    assert.deepEqual(areas(arrangementLoops(segs, 1e-6)), [12]);
  });

  it('finds the areas lines enclose by crossing (a # shape: the middle square)', () => {
    const segs: Segment[] = [[P(1, 0), P(1, 4)], [P(3, 0), P(3, 4)], [P(0, 1), P(4, 1)], [P(0, 3), P(4, 3)]];
    assert.deepEqual(areas(arrangementLoops(segs, 1e-6)), [4]);
  });

  it('splits a rectangle by its diagonal into two triangles, and ignores dangling ends', () => {
    const segs: Segment[] = [[P(0, 0), P(4, 0)], [P(4, 0), P(4, 2)], [P(4, 2), P(0, 2)], [P(0, 2), P(0, 0)], [P(0, 0), P(4, 2)], [P(4, 2), P(6, 5)]];
    assert.deepEqual(areas(arrangementLoops(segs, 1e-6)), [4, 4]);
  });

  it('welds ends that miss each other by less than the tolerance', () => {
    const segs: Segment[] = [[P(0, 0), P(2, 0)], [P(2.0004, 0), P(2, 2)], [P(2, 2), P(0, 2)], [P(0, 2), P(0, 0.0003)]];
    assert.deepEqual(areas(arrangementLoops(segs, 0.001)), [4]);
  });
});

describe('selfIntersects', () => {
  it('tells a bow tie from a concave L', () => {
    assert.equal(selfIntersects([P(0, 0), P(2, 2), P(2, 0), P(0, 2)]), true);
    assert.equal(selfIntersects([P(0, 0), P(4, 0), P(4, 1), P(1, 1), P(1, 4), P(0, 4)]), false);
  });
});
