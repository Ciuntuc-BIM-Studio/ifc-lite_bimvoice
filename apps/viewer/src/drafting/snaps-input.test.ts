/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DraftShape, Pt, SnapMode } from './types.js';
import { SnapIndex, findSnap } from './snaps.js';
import { applyOrtho, applyPolar, parseCoordinateInput, pointAlong } from './input.js';

const E = 1e-7;
function near(a: number, b: number, msg?: string): void {
  assert.ok(Math.abs(a - b) < E, `${msg ?? ''} expected ${b}, got ${a}`);
}
function nearPt(p: Pt, q: Pt, msg?: string): void {
  near(p.x, q.x, msg);
  near(p.y, q.y, msg);
}
const P = (x: number, y: number): Pt => ({ x, y });
const ALL: ReadonlySet<SnapMode> = new Set<SnapMode>([
  'endpoint', 'midpoint', 'center', 'quadrant', 'intersection', 'perpendicular', 'nearest',
]);

describe('SnapIndex', () => {
  it('returns only shapes near the query box', () => {
    const shapes: DraftShape[] = [];
    for (let i = 0; i < 100; i++) shapes.push({ type: 'line', a: P(i * 10, 0), b: P(i * 10 + 5, 0) });
    shapes.push({ type: 'circle', c: P(500, 500), r: 2 });
    const idx = new SnapIndex(shapes);
    const hit = idx.query(P(201, -1), P(204, 1));
    assert.ok(hit.includes(20));
    assert.ok(!hit.includes(0) && !hit.includes(99) && !hit.includes(100));
    assert.ok(hit.length < 20, `broad phase stays local (${hit.length})`);
    const fine = new SnapIndex(shapes, 1).query(P(201, -1), P(204, 1));
    assert.deepEqual(fine, [20], 'a fine grid isolates the shape');
    assert.ok(idx.query(P(499.9, 499.9), P(500.1, 500.1)).includes(100), 'circle found via its centre');
    assert.deepEqual(idx.query(P(5000, 5000), P(5001, 5001)), []);
  });
  it('handles 50,000 segments', () => {
    const shapes: DraftShape[] = [];
    for (let i = 0; i < 50000; i++) {
      const x = (i % 250) * 2;
      const y = Math.floor(i / 250) * 2;
      shapes.push({ type: 'line', a: P(x, y), b: P(x + 1, y) });
    }
    const idx = new SnapIndex(shapes);
    const ids = idx.query(P(10.4, 20 - 0.1), P(10.6, 20 + 0.1));
    assert.deepEqual(ids.filter((i) => {
      const s = shapes[i];
      return s.type === 'line' && s.a.x <= 10.6 && s.b.x >= 10.4 && Math.abs(s.a.y - 20) < 0.2;
    }), [10 * 250 + 5]);
    const snap = findSnap(P(10.95, 20.02), shapes, idx, { tolerance: 0.1, modes: ALL });
    assert.equal(snap?.mode, 'endpoint');
    nearPt(snap.point, P(11, 20));
  });
});

describe('findSnap', () => {
  const shapes: DraftShape[] = [
    { type: 'line', a: P(0, 0), b: P(10, 0) },
    { type: 'line', a: P(5, -5), b: P(5, 5) },
    { type: 'circle', c: P(20, 0), r: 3 },
  ];
  it('endpoint beats nearest', () => {
    const s = findSnap(P(9.8, 0.1), shapes, null, { tolerance: 0.5, modes: ALL });
    assert.equal(s?.mode, 'endpoint');
    nearPt(s.point, P(10, 0));
  });
  it('falls back to nearest when the endpoint mode is disabled', () => {
    const s = findSnap(P(9.8, 0.1), shapes, null, { tolerance: 0.5, modes: new Set<SnapMode>(['nearest']) });
    assert.equal(s?.mode, 'nearest');
    nearPt(s.point, P(9.8, 0));
  });
  it('finds intersections and midpoints with priority', () => {
    const s = findSnap(P(5.1, 0.1), shapes, null, { tolerance: 0.5, modes: ALL });
    assert.equal(s?.mode, 'intersection');
    nearPt(s.point, P(5, 0));
    const m = findSnap(P(2.6, 0.1), shapes, null, { tolerance: 0.5, modes: ALL });
    assert.equal(m?.mode, 'nearest', 'midpoint 5,0 is out of tolerance');
  });
  it('snaps to a centre from the curve or near the centre', () => {
    const modes = new Set<SnapMode>(['center', 'nearest']);
    const onCurve = findSnap(P(23.1, 0), shapes, null, { tolerance: 0.2, modes });
    assert.equal(onCurve?.mode, 'center');
    nearPt(onCurve.point, P(20, 0));
    const idx = new SnapIndex(shapes);
    const atCentre = findSnap(P(20.1, 0.1), shapes, idx, { tolerance: 0.2, modes });
    assert.equal(atCentre?.mode, 'center');
  });
  it('quadrant and perpendicular', () => {
    const all = findSnap(P(20.05, 3.05), shapes, null, { tolerance: 0.2, modes: ALL });
    assert.equal(all?.mode, 'center', 'center outranks quadrant');
    const qm = new Set<SnapMode>(['quadrant', 'nearest']);
    const q = findSnap(P(20.05, 3.05), shapes, null, { tolerance: 0.2, modes: qm });
    assert.equal(q?.mode, 'quadrant');
    nearPt(q.point, P(20, 3));
    const modes = new Set<SnapMode>(['perpendicular', 'nearest']);
    const p = findSnap(P(3.1, 0.05), shapes, null, { tolerance: 0.2, modes, from: P(3, 7) });
    assert.equal(p?.mode, 'perpendicular');
    nearPt(p.point, P(3, 0));
  });
  it('returns null when nothing is within tolerance', () => {
    assert.equal(findSnap(P(50, 50), shapes, null, { tolerance: 0.5, modes: ALL }), null);
  });
});

describe('coordinate input', () => {
  const last = P(1, 1);
  it('parses absolute and relative cartesian points', () => {
    assert.deepEqual(parseCoordinateInput('3,4', { last: null }), { kind: 'point', pt: P(3, 4) });
    assert.deepEqual(parseCoordinateInput(' -1.5 , 2. ', { last: null }), { kind: 'point', pt: P(-1.5, 2) });
    assert.deepEqual(parseCoordinateInput('@2,-3', { last }), { kind: 'point', pt: P(3, -2) });
    assert.deepEqual(parseCoordinateInput('@', { last }), { kind: 'point', pt: P(1, 1) });
  });
  it('parses polar forms', () => {
    const r = parseCoordinateInput('@2<90', { last });
    assert.ok(r?.kind === 'point');
    nearPt(r.pt, P(1, 3));
    const a = parseCoordinateInput('2 < 180', { last });
    assert.ok(a?.kind === 'point');
    nearPt(a.pt, P(-2, 0));
    const n = parseCoordinateInput('@1<-45', { last });
    assert.ok(n?.kind === 'point');
    nearPt(n.pt, P(1 + Math.SQRT1_2, 1 - Math.SQRT1_2));
  });
  it('parses a bare distance', () => {
    assert.deepEqual(parseCoordinateInput('2.5', { last: null }), { kind: 'distance', d: 2.5 });
    assert.deepEqual(parseCoordinateInput('-.5', { last: null }), { kind: 'distance', d: -0.5 });
  });
  it('rejects garbage and relative input without a last point', () => {
    for (const bad of ['', 'abc', '1,2,3', '1;2', '1,', '<5', '1<2<3', '@5', '1 2', '1e', '0x10']) {
      assert.equal(parseCoordinateInput(bad, { last }), null, `"${bad}"`);
    }
    assert.equal(parseCoordinateInput('@1,1', { last: null }), null);
    assert.equal(parseCoordinateInput('@1<30', { last: null }), null);
  });
});

describe('ortho / polar constraints', () => {
  it('applyOrtho snaps to the dominant axis', () => {
    assert.deepEqual(applyOrtho(P(0, 0), P(5, 1)), P(5, 0));
    assert.deepEqual(applyOrtho(P(1, 1), P(0, -4)), P(1, -4));
  });
  it('applyPolar rounds the angle and keeps the distance', () => {
    const p = applyPolar(P(0, 0), P(10, 1), 45);
    nearPt(p, P(Math.hypot(10, 1), 0));
    const q = applyPolar(P(0, 0), P(1, 0.9), 45);
    nearPt(q, P(Math.hypot(1, 0.9) * Math.SQRT1_2, Math.hypot(1, 0.9) * Math.SQRT1_2));
  });
  it('pointAlong moves a distance toward a target', () => {
    nearPt(pointAlong(P(0, 0), P(3, 4), 10), P(6, 8));
    nearPt(pointAlong(P(1, 1), P(1, 1), 2), P(3, 1));
  });
});
