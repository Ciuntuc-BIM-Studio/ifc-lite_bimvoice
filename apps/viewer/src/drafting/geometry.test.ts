/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DraftShape, Pt } from './types.js';
import { angleInArc, mirrorPt, normAngle, norm, rotatePt } from './vec.js';
import { nearestOnShape, shapeBounds, shapeKeyPoints, shapePrims } from './curves.js';
import { intersectPrims, intersectRayWithShape, intersectShapes } from './intersect.js';
import { mirrorShape, rotateShape, scaleShape, translateShape } from './transform.js';

const E = 1e-7;
function near(a: number, b: number, msg?: string): void {
  assert.ok(Math.abs(a - b) < E, `${msg ?? ''} expected ${b}, got ${a}`);
}
function nearPt(p: Pt, q: Pt, msg?: string): void {
  near(p.x, q.x, msg);
  near(p.y, q.y, msg);
}
function hasPt(list: readonly Pt[], q: Pt): boolean {
  return list.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6);
}
const P = (x: number, y: number): Pt => ({ x, y });
const H = Math.PI / 2;

describe('vec', () => {
  it('normalises angles and tests CCW sweeps with wrap-around', () => {
    near(normAngle(-H), 3 * H);
    near(normAngle(5 * Math.PI), Math.PI);
    assert.ok(angleInArc(0, 3 * H, H)); // sweep wraps through 0
    assert.ok(!angleInArc(Math.PI, 3 * H, H));
    assert.ok(angleInArc(H, 0, H)); // inclusive end
  });
  it('rotates, mirrors and normalises safely', () => {
    nearPt(rotatePt(P(2, 1), P(1, 1), H), P(1, 2));
    nearPt(mirrorPt(P(1, 2), P(0, 0), P(1, 0)), P(1, -2));
    nearPt(mirrorPt(P(2, 0), P(0, 0), P(1, 1)), P(0, 2));
    nearPt(norm(P(0, 0)), P(0, 0));
  });
});

describe('curves', () => {
  it('decomposes shapes into primitives', () => {
    assert.equal(shapePrims({ type: 'polyline', pts: [P(0, 0), P(1, 0), P(1, 1)], closed: true }).length, 3);
    assert.equal(shapePrims({ type: 'polyline', pts: [P(0, 0), P(1, 0), P(1, 1)], closed: false }).length, 2);
    const c = shapePrims({ type: 'circle', c: P(0, 0), r: 1 });
    assert.equal(c.length, 1);
    assert.ok(c[0].kind === 'arc' && c[0].full);
  });
  it('computes exact arc bounds including in-sweep quadrants', () => {
    const b = shapeBounds({ type: 'arc', c: P(0, 0), r: 2, start: 0, end: Math.PI });
    nearPt(b.min, P(-2, 0));
    nearPt(b.max, P(2, 2));
    const w = shapeBounds({ type: 'arc', c: P(0, 0), r: 1, start: -0.5, end: 0.5 });
    near(w.max.x, 1, 'wrapping arc includes angle 0');
    near(w.min.x, Math.cos(0.5));
  });
  it('finds the nearest point, clamping to arc ends', () => {
    const arc: DraftShape = { type: 'arc', c: P(0, 0), r: 1, start: 0, end: H };
    nearPt(nearestOnShape(arc, P(2, 2)).point, P(Math.SQRT1_2, Math.SQRT1_2));
    nearPt(nearestOnShape(arc, P(-1, -0.1)).point, P(0, 1)); // nearer end
    const line: DraftShape = { type: 'line', a: P(0, 0), b: P(10, 0) };
    near(nearestOnShape(line, P(5, 3)).dist, 3);
  });
  it('lists key points per shape type', () => {
    const arc = shapeKeyPoints({ type: 'arc', c: P(0, 0), r: 1, start: 0, end: Math.PI });
    assert.equal(arc.endpoints.length, 2);
    nearPt(arc.midpoints[0], P(0, 1));
    assert.equal(arc.quadrants.length, 3); // 0, π/2, π
    const circ = shapeKeyPoints({ type: 'circle', c: P(1, 1), r: 1 });
    assert.equal(circ.quadrants.length, 4);
    nearPt(circ.centers[0], P(1, 1));
    const pl = shapeKeyPoints({ type: 'polyline', pts: [P(0, 0), P(2, 0), P(2, 2)], closed: true });
    assert.equal(pl.endpoints.length, 3);
    assert.equal(pl.midpoints.length, 3);
  });
});

describe('intersect', () => {
  const seg = (a: Pt, b: Pt) => ({ kind: 'seg' as const, a, b });
  const arc = (c: Pt, r: number, start: number, end: number, full = false) => ({
    kind: 'arc' as const, c, r, start, end, full,
  });
  it('segment/segment: crossing, miss, touching end, collinear overlap', () => {
    const x = intersectPrims(seg(P(0, 0), P(2, 2)), seg(P(0, 2), P(2, 0)));
    assert.equal(x.length, 1);
    nearPt(x[0], P(1, 1));
    assert.equal(intersectPrims(seg(P(0, 0), P(1, 0)), seg(P(2, -1), P(2, 1))).length, 0);
    assert.equal(intersectPrims(seg(P(0, 0), P(1, 0)), seg(P(1, 0), P(1, 1))).length, 1);
    const ov = intersectPrims(seg(P(0, 0), P(3, 0)), seg(P(1, 0), P(5, 0)));
    assert.equal(ov.length, 2);
    assert.ok(hasPt(ov, P(1, 0)) && hasPt(ov, P(3, 0)));
  });
  it('segment/arc respects the sweep and handles tangency', () => {
    const upper = arc(P(0, 0), 1, 0, Math.PI);
    const hits = intersectPrims(seg(P(-2, 0.5), P(2, 0.5)), upper);
    assert.equal(hits.length, 2);
    assert.equal(intersectPrims(seg(P(-2, -0.5), P(2, -0.5)), upper).length, 0);
    const tan = intersectPrims(seg(P(-2, 1), P(2, 1)), upper);
    assert.equal(tan.length, 1);
    nearPt(tan[0], P(0, 1));
    // Segment stops short of the circle.
    assert.equal(intersectPrims(seg(P(0, 0), P(0.5, 0)), arc(P(0, 0), 1, 0, 0, true)).length, 0);
  });
  it('arc/arc: two points, tangency, concentric, outside sweep', () => {
    const a = arc(P(0, 0), 1, 0, 0, true);
    const b = arc(P(1, 0), 1, 0, 0, true);
    const x = intersectPrims(a, b);
    assert.equal(x.length, 2);
    assert.ok(hasPt(x, P(0.5, Math.sqrt(3) / 2)));
    const t = intersectPrims(a, arc(P(2, 0), 1, 0, 0, true));
    assert.equal(t.length, 1);
    nearPt(t[0], P(1, 0));
    assert.equal(intersectPrims(a, arc(P(0, 0), 2, 0, 0, true)).length, 0);
    assert.equal(intersectPrims(a, arc(P(0, 0), 1, 0, 0, true)).length, 0);
    // Upper half of `a` only meets b at the upper point.
    assert.equal(intersectPrims(arc(P(0, 0), 1, 0, Math.PI), b).length, 1);
  });
  it('shape-level intersections and rays', () => {
    const sq: DraftShape = { type: 'polyline', pts: [P(0, 0), P(2, 0), P(2, 2), P(0, 2)], closed: true };
    assert.equal(intersectShapes(sq, { type: 'line', a: P(-1, 1), b: P(3, 1) }).length, 2);
    const hits = intersectRayWithShape(P(-5, 1), P(1, 0), sq);
    assert.equal(hits.length, 2);
    near(hits[0].t, 5);
    near(hits[1].t, 7);
    assert.equal(intersectRayWithShape(P(5, 1), P(1, 0), sq).length, 0);
    const c = intersectRayWithShape(P(0, 0), P(1, 0), { type: 'circle', c: P(0, 0), r: 3 });
    assert.equal(c.length, 1);
    near(c[0].t, 3);
  });
});

describe('transform', () => {
  const arcPts = (s: DraftShape): Pt[] => {
    assert.ok(s.type === 'arc');
    const k = shapeKeyPoints(s);
    return [...k.endpoints, ...k.midpoints];
  };
  it('translates, rotates and scales', () => {
    const t = translateShape({ type: 'line', a: P(0, 0), b: P(1, 0) }, P(1, 2));
    assert.ok(t.type === 'line');
    nearPt(t.b, P(2, 2));
    const r = rotateShape({ type: 'arc', c: P(0, 0), r: 1, start: 0, end: H }, P(0, 0), H);
    assert.ok(r.type === 'arc');
    near(r.start, H);
    near(r.end, Math.PI);
    const s = scaleShape({ type: 'circle', c: P(1, 0), r: 1 }, P(0, 0), 2);
    assert.ok(s.type === 'circle');
    near(s.r, 2);
    nearPt(s.c, P(2, 0));
  });
  it('mirroring an arc keeps the same geometric point set', () => {
    const arc: DraftShape = { type: 'arc', c: P(1, 1), r: 2, start: 0.2, end: 1.4 };
    const a = P(0, 0);
    const b = P(1, 3);
    const m = mirrorShape(arc, a, b);
    const expected = arcPts(arc).map((p) => mirrorPt(p, a, b));
    const got = arcPts(m);
    for (const p of expected) assert.ok(hasPt(got, p), `mirrored point ${p.x},${p.y}`);
    // The arc's own midpoint maps to the mirrored arc's midpoint (sweep preserved).
    nearPt(shapeKeyPoints(m).midpoints[0], mirrorPt(shapeKeyPoints(arc).midpoints[0], a, b));
  });
});
