/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildAlignment, type HorizontalAlignment, type HorizontalAlignmentSpec } from './alignment.js';
import { buildLayout, curveThrough, layoutFromPis, layoutProblem, type LayoutEntity } from './alignment-layout.js';

const wrap = (a: number) => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;

/** Every segment starts where the one before it ends, in the same direction. */
function expectContinuous(a: HorizontalAlignment) {
  for (let k = 1; k < a.segments.length; k++) {
    const s = a.segments[k];
    const before = a.pointAt(s.station - 1e-7), after = a.pointAt(s.station + 1e-7);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1e-4);
    expect(Math.abs(wrap(after.direction - before.direction))).toBeLessThan(1e-4);
  }
}

describe('alignment layout (fixed / floating / free)', () => {
  it('reproduces a PI chain: fixed lines and free curves with spirals', () => {
    const spec: HorizontalAlignmentSpec = { pis: [{ x: 0, y: 0 }, { x: 300, y: 0, radius: 150, spiralIn: 60, spiralOut: 40 }, { x: 300, y: -300, radius: 100 }, { x: 100, y: -500 }], startStation: 100 };
    const fromPis = buildAlignment(spec);
    const fromLayout = buildAlignment({ ...spec, layout: layoutFromPis(spec.pis) });
    expect(fromLayout.length).toBeCloseTo(fromPis.length, 6);
    expect(fromLayout.segments.map((s) => s.kind)).toEqual(fromPis.segments.map((s) => s.kind));
    const [p, q] = [fromPis.pointAt(fromPis.endStation), fromLayout.pointAt(fromLayout.endStation)];
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.y).toBeCloseTo(p.y, 6);
    expectContinuous(fromLayout);
  });

  it('fillets a fixed curve with free curves to fixed lines either side', () => {
    const layout: LayoutEntity[] = [
      { kind: 'line', constraint: 'fixed', a: [0, 0], b: [200, 0] },
      { kind: 'curve', constraint: 'free', radius: 80 },
      // A fixed curve turning left around (300, 100): survey-tied, no tangency of its own.
      { kind: 'curve', constraint: 'fixed', center: [300, 100], radius: 120, turn: 1 },
      { kind: 'curve', constraint: 'free', radius: 60 },
      { kind: 'line', constraint: 'fixed', a: [410, 200], b: [410, 400] },
    ];
    expect(layoutProblem(layout)).toBeNull();
    const a = buildLayout(layout, 0);
    expect(a.segments.map((s) => s.kind)).toEqual(['line', 'arc', 'arc', 'arc', 'line']);
    expectContinuous(a);
    // The fixed curve stays on its circle.
    const mid = a.pointAt(a.segments[2].station + a.segments[2].length / 2);
    expect(Math.hypot(mid.x - 300, mid.y - 100)).toBeCloseTo(120, 6);
    // And the last line runs on its own line, to its end point.
    const end = a.pointAt(a.endStation);
    expect(end.x).toBeCloseTo(410, 6);
    expect(end.y).toBeCloseTo(400, 6);
  });

  it('hangs a floating curve (radius, length) on a line and a floating line through a point on the curve', () => {
    const layout: LayoutEntity[] = [
      { kind: 'line', constraint: 'fixed', a: [0, 0], b: [100, 0] },
      { kind: 'curve', constraint: 'floating', radius: 100, length: 50, turn: -1 },
      { kind: 'line', constraint: 'floating', through: [300, -200] },
    ];
    const a = buildLayout(layout, 0);
    expectContinuous(a);
    const end = a.pointAt(a.endStation);
    expect(end.x).toBeCloseTo(300, 6);
    expect(end.y).toBeCloseTo(-200, 6);
    // The curve starts at the line's end, tangent to it, turning right.
    expect(a.segments[1].start[0]).toBeCloseTo(100, 9);
    expect(a.segments[1].turn).toBe(-1);
  });

  it('ends on a floating curve of its own length', () => {
    const a = buildLayout([
      { kind: 'line', constraint: 'fixed', a: [0, 0], b: [100, 0] },
      { kind: 'curve', constraint: 'floating', radius: 50, length: 50 * Math.PI / 2, turn: 1 },
    ], 0);
    const end = a.pointAt(a.endStation);
    expect(end.x).toBeCloseTo(150, 6);
    expect(end.y).toBeCloseTo(50, 6);
    expect(end.direction).toBeCloseTo(Math.PI / 2, 6);
  });

  it('joins two fixed curves with a free line tangent to both (a reverse curve)', () => {
    const layout: LayoutEntity[] = [
      { kind: 'line', constraint: 'fixed', a: [-100, 0], b: [0, 0] },
      { kind: 'curve', constraint: 'floating', radius: 100, length: 60, turn: 1 },
      { kind: 'line', constraint: 'free' },
      { kind: 'curve', constraint: 'fixed', center: [300, 250], radius: 90, turn: -1 },
      { kind: 'line', constraint: 'floating', through: [600, 200] },
    ];
    expect(layoutProblem(layout)).toBeNull();
    const a = buildLayout(layout, 0);
    expectContinuous(a);
    expect(a.segments.map((s) => s.kind)).toEqual(['line', 'arc', 'line', 'arc', 'line']);
  });

  it('says why entities cannot be laid out', () => {
    const line = (a: [number, number], b: [number, number]): LayoutEntity => ({ kind: 'line', constraint: 'fixed', a, b });
    expect(layoutProblem([line([0, 0], [100, 0]), line([100, 0], [200, 100])])).toMatch(/do not join/);
    expect(layoutProblem([line([0, 0], [100, 0]), { kind: 'curve', constraint: 'free', radius: 50 }, { kind: 'line', constraint: 'free' }, line([0, 0], [1, 1])])).toMatch(/another free entity/);
    expect(layoutProblem([line([0, 0], [100, 0]), { kind: 'curve', constraint: 'free', radius: 50 }, { kind: 'line', constraint: 'floating', through: [5, 5] }])).toMatch(/hangs on a free entity/);
    expect(layoutProblem([{ kind: 'curve', constraint: 'fixed', center: [0, 0], radius: 5, turn: 1 }])).toMatch(/starts with a fixed line/);
  });

  it('finds the circle through three points, and its sense', () => {
    const c = curveThrough([0, 0], [10, 10], [20, 0]);
    expect(c.center[0]).toBeCloseTo(10, 9);
    expect(c.center[1]).toBeCloseTo(0, 9);
    expect(c.radius).toBeCloseTo(10, 9);
    expect(c.turn).toBe(-1);
  });
});
