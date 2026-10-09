/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { alignmentFromPolyline, alignmentProblem, buildAlignment, clothoidPoint, formatStation, type HorizontalAlignmentSpec } from './alignment.js';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

/** Every segment ends where the next starts, with the same direction. */
function expectContinuous(spec: HorizontalAlignmentSpec) {
  const a = buildAlignment(spec);
  for (let i = 1; i < a.segments.length; i++) {
    const prev = a.segments[i - 1];
    const end = a.pointAt(prev.station + prev.length);
    close(end.x, a.segments[i].start[0], 1e-6);
    close(end.y, a.segments[i].start[1], 1e-6);
    close(Math.cos(end.direction), Math.cos(a.segments[i].direction), 1e-6);
    close(Math.sin(end.direction), Math.sin(a.segments[i].direction), 1e-6);
  }
  const last = spec.pis[spec.pis.length - 1];
  const tip = a.pointAt(a.endStation);
  close(tip.x, last.x, 1e-6);
  close(tip.y, last.y, 1e-6);
  return a;
}

describe('horizontal alignment', () => {
  it('a straight polyline is lines of the polyline length', () => {
    const a = buildAlignment({ pis: [{ x: 0, y: 0 }, { x: 100, y: 0 }], startStation: 1000 });
    expect(a.segments).toHaveLength(1);
    expect(a.length).toBe(100);
    expect(a.pointAt(1050)).toMatchObject({ x: 50, y: 0, direction: 0, curvature: 0 });
  });

  it('clothoid coordinates match the numerically integrated Euler spiral', () => {
    const R = 100, L = 50, n = 2000;
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n * L;
      const theta = t * t / (2 * R * L);
      x += Math.cos(theta) * L / n;
      y += Math.sin(theta) * L / n;
    }
    const [cx, cy] = clothoidPoint(L, R, L);
    close(cx, x, 1e-5);
    close(cy, y, 1e-5);
  });

  it('a PI with a radius becomes line, arc, line with the textbook tangent length', () => {
    const spec: HorizontalAlignmentSpec = { pis: [{ x: 0, y: 0 }, { x: 200, y: 0, radius: 100 }, { x: 200, y: 200 }] };
    const a = expectContinuous(spec);
    expect(a.segments.map((s) => s.kind)).toEqual(['line', 'arc', 'line']);
    // T = R tan(Δ/2) = 100 for a 90° turn.
    close(a.segments[0].length, 100);
    close(a.segments[1].length, Math.PI / 2 * 100);
    close(a.segments[1].turn, 1);
    const mid = a.pointAt(100 + Math.PI / 4 * 100);
    close(mid.curvature, 0.01);
    close(mid.direction, Math.PI / 4);
  });

  it('spirals: curvature grows linearly in, holds on the arc, and fades out; the SCS tangent matches k + (R + p) tan(Δ/2)', () => {
    const spec: HorizontalAlignmentSpec = { pis: [{ x: 0, y: 0 }, { x: 300, y: 0, radius: 150, spiralIn: 60, spiralOut: 60 }, { x: 300, y: -300 }] };
    const a = expectContinuous(spec);
    expect(a.segments.map((s) => s.kind)).toEqual(['line', 'spiralIn', 'arc', 'spiralOut', 'line']);
    const [, sIn, arc, sOut] = a.segments;
    close(a.pointAt(sIn.station).curvature, 0);
    close(a.pointAt(sIn.station + 30).curvature, -1 / 150 / 2, 1e-9);
    close(a.pointAt(sIn.station + 60).curvature, -1 / 150, 1e-9);
    close(a.pointAt(arc.station + arc.length / 2).curvature, -1 / 150, 1e-9);
    close(a.pointAt(sOut.station + 30).curvature, -1 / 150 / 2, 1e-9);
    close(a.pointAt(sOut.station + 60).curvature, 0, 1e-9);
    const theta = 60 / (2 * 150);
    const [xs, ys] = clothoidPoint(60, 150, 60);
    const p = ys - 150 * (1 - Math.cos(theta)), k = xs - 150 * Math.sin(theta);
    const T = k + (150 + p) * Math.tan(Math.PI / 4);
    close(a.segments[0].length, 300 - T, 1e-6);
    close(a.segments[4].length, 300 - T, 1e-6);
  });

  it('unequal spirals still join', () => {
    expectContinuous({ pis: [{ x: 0, y: 0 }, { x: 250, y: 50, radius: 120, spiralIn: 40, spiralOut: 80 }, { x: 300, y: 300, radius: 60, spiralOut: 30 }, { x: 100, y: 500, radius: 80 }, { x: -100, y: 500 }] });
  });

  it('refuses a kink without a radius and curves that overlap', () => {
    expect(alignmentProblem({ pis: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] })).toMatch(/no radius/);
    expect(alignmentProblem({ pis: [{ x: 0, y: 0 }, { x: 100, y: 0, radius: 500 }, { x: 100, y: 100 }] })).toMatch(/overlaps|runs past/);
    expect(alignmentProblem({ pis: [{ x: 0, y: 0 }, { x: 200, y: 0, radius: 100 }, { x: 200, y: 200 }] })).toBeNull();
  });

  it('fits radii to a drawn polyline where the wanted one does not fit', () => {
    const spec = alignmentFromPolyline([[0, 0], [50, 0], [50, 50], [200, 50]], 100);
    expect(spec.pis[1].radius!).toBeLessThan(100);
    expect(spec.pis[2].radius!).toBeLessThan(100);
    expect(alignmentProblem(spec)).toBeNull();
    expect(alignmentFromPolyline([[0, 0], [500, 0], [500, 500]], 100).pis[1].radius).toBe(100);
  });

  it('formats stations', () => {
    expect(formatStation(0)).toBe('0+000.00');
    expect(formatStation(1234.5)).toBe('1+234.50');
  });
});
