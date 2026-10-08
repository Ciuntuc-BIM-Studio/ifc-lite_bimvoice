/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { roofGeometry, type RoofEdgeRule } from './roof-system.js';

type Vec2 = [number, number];
const rect: Vec2[] = [[0, 0], [10, 0], [10, 6], [0, 6]];
const eave = (pitch = 30, overhang = 0): RoofEdgeRule => ({ kind: 'eave', pitch, overhang });
const gable = (overhang = 0): RoofEdgeRule => ({ kind: 'gable', pitch: 0, overhang });
const t30 = Math.tan(Math.PI / 6);
const maxZ = (g: ReturnType<typeof roofGeometry>) => Math.max(...g.planes.flatMap((p) => p.pts.map((q) => q[2])));

describe('roof system geometry', () => {
  it('builds a hip roof: four planes, a ridge and four hips', () => {
    const g = roofGeometry(rect, [eave(), eave(), eave(), eave()]);
    expect(g.planes).toHaveLength(4);
    expect(maxZ(g)).toBeCloseTo(3 * t30, 9);
    const kinds = g.lines.map((l) => l.kind).sort();
    expect(kinds.filter((k) => k === 'hip')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'ridge')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'eave')).toHaveLength(4);
    const ridge = g.lines.find((l) => l.kind === 'ridge')!;
    expect(Math.hypot(ridge.b[0] - ridge.a[0], ridge.b[1] - ridge.a[1])).toBeCloseTo(4, 9);
  });

  it('turns gable edges into vertical ends and runs the ridge the full length', () => {
    const g = roofGeometry(rect, [eave(), gable(), eave(), gable()]);
    expect(g.planes).toHaveLength(2);
    expect(g.gables).toHaveLength(2);
    const ridge = g.lines.find((l) => l.kind === 'ridge')!;
    expect(Math.abs(ridge.b[0] - ridge.a[0])).toBeCloseTo(10, 9);
    expect(ridge.a[2]).toBeCloseTo(3 * t30, 9);
    for (const end of g.gables) expect(Math.max(...end.pts.map((p) => p[2]))).toBeCloseTo(3 * t30, 9);
    expect(g.lines.filter((l) => l.kind === 'verge')).toHaveLength(4);
  });

  it('moves the ridge where planes of different pitches meet', () => {
    const g = roofGeometry(rect, [eave(45), gable(), eave(30), gable()]);
    const x = (6 * t30) / (1 + t30);
    const ridge = g.lines.find((l) => l.kind === 'ridge')!;
    expect(ridge.a[1]).toBeCloseTo(x, 6);
    expect(ridge.a[2]).toBeCloseTo(x, 6);
  });

  it('drops the eaves by the overhang and keeps the wall plate at z = 0', () => {
    const g = roofGeometry(rect, [eave(30, 0.5), gable(0.3), eave(30, 0.5), gable(0.3)]);
    const all = g.planes.flatMap((p) => p.pts);
    expect(Math.min(...all.map((p) => p[1]))).toBeCloseTo(-0.5, 9);
    expect(Math.min(...all.map((p) => p[2]))).toBeCloseTo(-0.5 * t30, 9);
    expect(Math.min(...all.map((p) => p[0]))).toBeCloseTo(-0.3, 9);
    expect(maxZ(g)).toBeCloseTo(3 * t30, 9);
  });

  it('cuts each plane at its own eave when overhangs differ', () => {
    const g = roofGeometry(rect, [eave(30, 1), eave(30, 0.2), eave(30, 0.2), eave(30, 0.2)]);
    const front = g.planes.find((p) => p.edge === 0)!;
    expect(Math.min(...front.pts.map((p) => p[1]))).toBeCloseTo(-1, 9);
    const side = g.planes.find((p) => p.edge === 1)!;
    expect(Math.max(...side.pts.map((p) => p[0]))).toBeCloseTo(10.2, 9);
    expect(maxZ(g)).toBeCloseTo(3 * t30, 9);
  });

  it('finds the valley of an L-shaped roof', () => {
    const L: Vec2[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const g = roofGeometry(L, L.map(() => eave(35)));
    expect(g.planes).toHaveLength(6);
    expect(g.lines.filter((l) => l.kind === 'valley')).toHaveLength(1);
    const valley = g.lines.find((l) => l.kind === 'valley')!;
    // From the inner corner (4, 4) up into the roof.
    expect(Math.hypot(valley.a[0] - 4, valley.a[1] - 4)).toBeLessThan(1e-6);
  });

  it('accepts a clockwise outline, keeping each rule on its edge', () => {
    const cw: Vec2[] = [[0, 0], [0, 6], [10, 6], [10, 0]];
    // Edges: left, top, right, bottom — the short ones (left, right) are gables.
    const g = roofGeometry(cw, [gable(), eave(), gable(), eave()]);
    expect(g.gables).toHaveLength(2);
    expect(g.planes).toHaveLength(2);
  });

  it('refuses rules that cannot be built', () => {
    expect(() => roofGeometry(rect, [gable(), gable(), gable(), gable()])).toThrow(/eave/);
    expect(() => roofGeometry(rect, [eave(90), eave(), eave(), eave()])).toThrow(/pitch/i);
  });
});
