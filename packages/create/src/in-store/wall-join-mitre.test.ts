/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mitred `L` corners: both walls cut on the corner's diagonal, the style
 * stored on the relationship and kept when the corner is moved.
 */

import { describe, expect, it } from 'vitest';
import { computeWallJoin, wallBodyOutline, type PlanPoint, type WallJoinWall } from './wall-join.js';
import { addWallToStore, type WallInStoreParams } from './wall.js';
import { joinWallsInStore, reshapeWallsInStore } from './wall-join-edit.js';
import { readWallJoinRels, readWallJoinTarget } from './wall-join-read.js';
import { newStorey } from './wall-join-mesh.oracle.js';

const w = (start: PlanPoint, end: PlanPoint, thickness = 0.2): WallJoinWall => ({ start, end, thickness });

describe('computeWallJoin, mitre', () => {
  it('cuts both walls of a right-angle corner on the diagonal', () => {
    const join = computeWallJoin(w([0, 0], [5, 0]), w([5, 0], [5, 4]), { style: 'mitre' });
    expect(join.kind).toBe('L');
    expect(join.style).toBe('mitre');
    expect(join.a.runsThrough).toBe(false);
    expect(join.b.runsThrough).toBe(false);
    // Wall a: the inner (left) face stops 0.1 short, the outer (right) face reaches 0.1 past.
    expect(join.a.wall.endCut!.left).toBeCloseTo(-0.1, 9);
    expect(join.a.wall.endCut!.right).toBeCloseTo(0.1, 9);
    expect(join.b.wall.startCut!.left).toBeCloseTo(-0.1, 9);
    expect(join.b.wall.startCut!.right).toBeCloseTo(0.1, 9);
    expect(wallBodyOutline(join.a.wall).rectangular).toBe(false);
  });

  it('meets on the diagonal for walls of different thickness at any angle', () => {
    const a = w([0, 0], [4, 0], 0.3);
    const b = w([4, 0], [4 + 3 * Math.cos(2), 3 * Math.sin(2)], 0.1);
    const join = computeWallJoin(a, b, { style: 'mitre' });
    // Each outline's far corners at the joint lie on one shared line.
    const corner = (wall: WallJoinWall, which: 'start' | 'end') => {
      const o = wallBodyOutline(wall);
      const dx = (wall.end[0] - wall.start[0]) / o.length, dy = (wall.end[1] - wall.start[1]) / o.length;
      const toPlan = (p: PlanPoint): PlanPoint => [wall.start[0] + p[0] * dx - p[1] * dy, wall.start[1] + p[0] * dy + p[1] * dx];
      return which === 'end' ? [toPlan(o.corners[1]), toPlan(o.corners[2])] : [toPlan(o.corners[0]), toPlan(o.corners[3])];
    };
    const [a1, a2] = corner(join.a.wall, 'end');
    const [b1, b2] = corner(join.b.wall, 'start');
    const onLine = (p: PlanPoint) => (a2[0] - a1[0]) * (p[1] - a1[1]) - (a2[1] - a1[1]) * (p[0] - a1[0]);
    expect(onLine(b1)).toBeCloseTo(0, 9);
    expect(onLine(b2)).toBeCloseTo(0, 9);
  });

  it('never mitres a T', () => {
    const join = computeWallJoin(w([0, 0], [6, 0]), w([3, 0], [3, 4]), { style: 'mitre' });
    expect(join.kind).toBe('T');
    expect(join.style).toBe('butt');
  });
});

describe('mitred joins in the store', () => {
  const params = (start: PlanPoint, end: PlanPoint): WallInStoreParams =>
    ({ Start: [start[0], start[1], 0], End: [end[0], end[1], 0], Thickness: 0.2, Height: 3, Axis: true });

  it('stores the style and keeps it when the corner moves', async () => {
    const s = await newStorey();
    const a = addWallToStore(s.editor, s.anchor, params([0, 0], [5, 0])).wallId;
    const b = addWallToStore(s.editor, s.anchor, params([5, 0], [5, 4])).wallId;
    joinWallsInStore(s.editor, s.store, s.joinAnchor, a, b, { style: 'mitre' });
    expect(readWallJoinRels(s.store, s.editor.getMutationView()).map((r) => r.style)).toEqual(['mitre']);

    reshapeWallsInStore(s.editor, s.store, s.joinAnchor, [{ wallId: a, end: [6, 0] }], { moveJoinedEnds: true });
    const rels = readWallJoinRels(s.store, s.editor.getMutationView());
    expect(rels.map((r) => r.style)).toEqual(['mitre']);
    const moved = readWallJoinTarget(s.store, s.editor.getMutationView(), a, 1)!.wall;
    expect(moved.end).toEqual([6, 0]);
    // Still on the diagonal (the corner is no longer square): inner face short, outer face past.
    expect(moved.endCut!.left).toBeLessThan(0);
    expect(moved.endCut!.right).toBeGreaterThan(0);

    // Rejoining as butt switches it back.
    joinWallsInStore(s.editor, s.store, s.joinAnchor, a, b, { style: 'butt' });
    expect(readWallJoinRels(s.store, s.editor.getMutationView()).map((r) => r.style)).toEqual(['butt']);
  });
});
