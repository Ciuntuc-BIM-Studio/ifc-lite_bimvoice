/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { defaultTimberFrame, timberFrameParts, timberFrameProblem, type FramePiece } from './timber-frame.js';

const wall = { length: 5, height: 2.6, thickness: 0.2 };
const spec = defaultTimberFrame();
const of = (pieces: FramePiece[], role: string) => pieces.filter((p) => p.role === role);
const inside = (p: FramePiece, o: { x0: number; x1: number; z0: number; z1: number }) =>
  p.box.x[0] < o.x1 - 1e-9 && o.x0 < p.box.x[1] - 1e-9 && p.box.z[0] < o.z1 - 1e-9 && o.z0 < p.box.z[1] - 1e-9;

describe('timber frame', () => {
  it('a plain wall: sole and head plates, studs at the ends and every spacing, a nogging row, boards both faces', () => {
    const pieces = timberFrameParts(spec, wall, []);
    expect(of(pieces, 'plate')).toHaveLength(3);
    // Centres 0.03, 0.625, 1.25 … 4.375 and the end stud.
    expect(of(pieces, 'stud')).toHaveLength(Math.floor((5 - 0.03) / 0.625) + 1 + 1);
    expect(of(pieces, 'nogging').length).toBe(of(pieces, 'stud').length - 1);
    expect(of(pieces, 'sheathing')).toHaveLength(1);
    expect(of(pieces, 'lining')).toHaveLength(1);
    // The framing fills what the boards leave: 200 − 15 − 12.5 mm.
    const stud = of(pieces, 'stud')[0];
    expect(stud.box.y[1] - stud.box.y[0]).toBeCloseTo(0.1725, 6);
    expect(stud.box.z).toEqual([0.06, 2.6 - 0.12]);
  });

  it('a window: kings, jacks, header, sill and cripples; nothing of the frame or the boards in the hole', () => {
    const win = { x0: 1.5, x1: 2.7, z0: 0.9, z1: 2.1 };
    const pieces = timberFrameParts(spec, wall, [win]);
    expect(of(pieces, 'king')).toHaveLength(2);
    expect(of(pieces, 'jack')).toHaveLength(2);
    expect(of(pieces, 'header')).toHaveLength(1);
    expect(of(pieces, 'sill')).toHaveLength(1);
    expect(of(pieces, 'cripple').length).toBeGreaterThan(0);
    for (const p of pieces) expect(inside(p, win), `${p.key} in the window`).toBe(false);
    // The boards go round it: strips either side, pieces above and below.
    expect(of(pieces, 'sheathing').map((p) => p.key).sort()).toEqual(['sheathing:0:above', 'sheathing:0:below', 'sheathing:0:strip', 'sheathing:end']);
  });

  it('a door (down to the floor): no sill, no cripples under it', () => {
    const door = { x0: 3, x1: 3.9, z0: 0, z1: 2.1 };
    const pieces = timberFrameParts(spec, wall, [door]);
    expect(of(pieces, 'sill')).toHaveLength(0);
    expect(pieces.some((p) => p.key.includes(':bottom:'))).toBe(false);
    for (const p of pieces.filter((x) => x.role !== 'plate')) expect(inside(p, door), `${p.key} in the door`).toBe(false);
  });

  it('refuses a wall too thin for its boards', () => {
    expect(timberFrameProblem(spec, { ...wall, thickness: 0.05 })).toMatch(/thin/);
    expect(() => timberFrameParts({ ...spec, spacing: 0.05 }, wall, [])).toThrow(/spacing/);
  });
});
