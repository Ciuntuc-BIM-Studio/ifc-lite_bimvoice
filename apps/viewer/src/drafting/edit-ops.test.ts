/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { DraftShape, Pt } from './types.js';
import { offsetShape, pointInPolygon } from './offset.js';
import { extendShape, trimShape } from './trim.js';
import { chamferLines, filletLines, type LineShape } from './fillet.js';
import { shapeKeyPoints } from './curves.js';
import { dist } from './vec.js';

const E = 1e-7;
function near(a: number, b: number, msg?: string): void {
  assert.ok(Math.abs(a - b) < E, `${msg ?? ''} expected ${b}, got ${a}`);
}
function nearPt(p: Pt, q: Pt, msg?: string): void {
  near(p.x, q.x, msg);
  near(p.y, q.y, msg);
}
const P = (x: number, y: number): Pt => ({ x, y });
const line = (a: Pt, b: Pt): LineShape => ({ type: 'line', a, b });
const H = Math.PI / 2;

describe('offset', () => {
  it('offsets a line toward the side point', () => {
    const up = offsetShape(line(P(0, 0), P(4, 0)), 1, P(2, 5));
    assert.ok(up?.type === 'line');
    nearPt(up.a, P(0, 1));
    nearPt(up.b, P(4, 1));
    const down = offsetShape(line(P(0, 0), P(4, 0)), 1, P(2, -5));
    assert.ok(down?.type === 'line');
    near(down.a.y, -1);
  });
  it('offsets circles and arcs, refusing a collapsed radius', () => {
    const out = offsetShape({ type: 'circle', c: P(0, 0), r: 2 }, 0.5, P(5, 0));
    assert.ok(out?.type === 'circle');
    near(out.r, 2.5);
    const inn = offsetShape({ type: 'arc', c: P(0, 0), r: 2, start: 0, end: H }, 0.5, P(0.5, 0.5));
    assert.ok(inn?.type === 'arc');
    near(inn.r, 1.5);
    near(inn.end, H);
    assert.equal(offsetShape({ type: 'circle', c: P(0, 0), r: 1 }, 2, P(0.1, 0)), null);
  });
  it('offsets an open L polyline with a miter join', () => {
    const l: DraftShape = { type: 'polyline', pts: [P(0, 0), P(4, 0), P(4, 4)], closed: false };
    const o = offsetShape(l, 1, P(2, 1)); // inside the L
    assert.ok(o?.type === 'polyline');
    assert.equal(o.pts.length, 3);
    nearPt(o.pts[0], P(0, 1));
    nearPt(o.pts[1], P(3, 1));
    nearPt(o.pts[2], P(3, 4));
  });
  it('offsets closed polylines inward and outward regardless of winding', () => {
    const cw: DraftShape = { type: 'polyline', pts: [P(0, 0), P(0, 4), P(4, 4), P(4, 0)], closed: true };
    const inward = offsetShape(cw, 1, P(2, 2));
    assert.ok(inward?.type === 'polyline' && inward.closed);
    assert.equal(inward.pts.length, 4);
    for (const p of inward.pts) {
      near(Math.abs(p.x - 2), 1);
      near(Math.abs(p.y - 2), 1);
    }
    const outward = offsetShape(cw, 1, P(10, 2));
    assert.ok(outward?.type === 'polyline');
    assert.ok(outward.pts.some((p) => dist(p, P(-1, -1)) < E));
    assert.ok(outward.pts.some((p) => dist(p, P(5, 5)) < E));
  });
  it('joins collinear consecutive segments without a spurious corner', () => {
    const s: DraftShape = { type: 'polyline', pts: [P(0, 0), P(2, 0), P(4, 0)], closed: false };
    const o = offsetShape(s, 1, P(1, 1));
    assert.ok(o?.type === 'polyline');
    nearPt(o.pts[1], P(2, 1));
    nearPt(o.pts[2], P(4, 1));
  });
  it('point in polygon', () => {
    const sq = [P(0, 0), P(2, 0), P(2, 2), P(0, 2)];
    assert.equal(pointInPolygon(P(1, 1), sq), true);
    assert.equal(pointInPolygon(P(3, 1), sq), false);
  });
});

describe('trim', () => {
  const cutters: DraftShape[] = [line(P(2, -1), P(2, 1)), line(P(6, -1), P(6, 1))];
  it('removes the middle of a line between two cutters', () => {
    const target = line(P(0, 0), P(10, 0));
    const r = trimShape(target, [target, ...cutters], P(4, 0.1));
    assert.ok(r);
    assert.equal(r.length, 2);
    const [a, b] = r;
    assert.ok(a.type === 'line' && b.type === 'line');
    nearPt(a.a, P(0, 0));
    nearPt(a.b, P(2, 0));
    nearPt(b.a, P(6, 0));
    nearPt(b.b, P(10, 0));
  });
  it('removes an end piece and returns null without intersections', () => {
    const r = trimShape(line(P(0, 0), P(10, 0)), cutters, P(9, 0));
    assert.ok(r);
    assert.equal(r.length, 2);
    assert.ok(r[1].type === 'line');
    nearPt(r[1].a, P(2, 0));
    nearPt(r[1].b, P(6, 0));
    assert.equal(trimShape(line(P(0, 5), P(10, 5)), cutters, P(1, 5)), null);
  });
  it('turns a cut circle into the remaining arc', () => {
    const circle: DraftShape = { type: 'circle', c: P(0, 0), r: 1 };
    const cut = line(P(0, -2), P(0, 2)); // cuts at angles π/2 and 3π/2
    const r = trimShape(circle, [cut], P(1, 0)); // remove the right half
    assert.ok(r && r.length === 1);
    const arc = r[0];
    assert.ok(arc.type === 'arc');
    near(arc.start, H);
    near(arc.end, 3 * H);
    nearPt(shapeKeyPoints(arc).midpoints[0], P(-1, 0));
    assert.equal(trimShape(circle, [line(P(0, 0), P(0, 2))], P(1, 0)), null, 'one cut cannot split a loop');
  });
  it('opens a closed polyline cut at two points', () => {
    const sq: DraftShape = { type: 'polyline', pts: [P(0, 0), P(4, 0), P(4, 4), P(0, 4)], closed: true };
    const r = trimShape(sq, [line(P(2, -1), P(2, 5))], P(4, 2)); // drop the right half
    assert.ok(r && r.length === 1);
    const pl = r[0];
    assert.ok(pl.type === 'polyline' && !pl.closed);
    assert.equal(pl.pts.length, 4);
    nearPt(pl.pts[0], P(2, 4));
    nearPt(pl.pts[1], P(0, 4));
    nearPt(pl.pts[3], P(2, 0));
  });
  it('trims an arc', () => {
    const arc: DraftShape = { type: 'arc', c: P(0, 0), r: 1, start: 0, end: Math.PI };
    const r = trimShape(arc, [line(P(0, 0), P(0, 2))], P(1, 0.1));
    assert.ok(r && r.length === 1 && r[0].type === 'arc');
    near(r[0].start, H);
    near(r[0].end, Math.PI);
  });
});

describe('extend', () => {
  const wall = line(P(10, -5), P(10, 5));
  it('extends the line end nearest the pick to the boundary', () => {
    const r = extendShape(line(P(0, 0), P(4, 0)), [wall, line(P(20, -5), P(20, 5))], P(3.9, 0));
    assert.ok(r?.type === 'line');
    nearPt(r.a, P(0, 0));
    nearPt(r.b, P(10, 0));
    assert.equal(extendShape(line(P(0, 0), P(4, 0)), [wall], P(0.1, 0)), null, 'no boundary behind a');
  });
  it('extends the last segment of an open polyline', () => {
    const pl: DraftShape = { type: 'polyline', pts: [P(0, 0), P(0, 2), P(3, 2)], closed: false };
    const r = extendShape(pl, [wall], P(3, 2));
    assert.ok(r?.type === 'polyline');
    nearPt(r.pts[2], P(10, 2));
  });
  it('extends an arc along its circle', () => {
    const arc: DraftShape = { type: 'arc', c: P(0, 0), r: 1, start: 0, end: H / 2 };
    const r = extendShape(arc, [line(P(-2, 0.5), P(0, 0.5))], P(0.7, 0.7));
    assert.ok(r?.type === 'arc');
    near(r.start, 0);
    near(r.end, (5 * Math.PI) / 6); // y = 0.5 on the left half
  });
});

describe('fillet and chamfer', () => {
  const h = line(P(0, 0), P(10, 0));
  const v = line(P(5, -5), P(5, 5));
  it('fillets perpendicular lines with r=1', () => {
    const f = filletLines(h, P(1, 0), v, P(5, 4), 1);
    assert.ok(f && f.arc?.type === 'arc');
    assert.ok(f.first.type === 'line' && f.second.type === 'line');
    nearPt(f.first.a, P(0, 0));
    nearPt(f.first.b, P(4, 0));
    nearPt(f.second.a, P(5, 1));
    nearPt(f.second.b, P(5, 5));
    nearPt(f.arc.c, P(4, 1));
    near(f.arc.r, 1);
    const k = shapeKeyPoints(f.arc);
    assert.ok(k.endpoints.some((p) => dist(p, P(4, 0)) < E));
    assert.ok(k.endpoints.some((p) => dist(p, P(5, 1)) < E));
    near(dist(k.midpoints[0], P(5, 0)), Math.SQRT2 - 1, 'arc bulges toward the corner');
  });
  it('radius 0 makes a corner; parallel or oversize returns null', () => {
    const f = filletLines(line(P(0, 0), P(4, 0)), P(1, 0), line(P(5, 1), P(5, 5)), P(5, 4), 0);
    assert.ok(f && f.arc === null && f.first.type === 'line' && f.second.type === 'line');
    nearPt(f.first.b, P(5, 0));
    nearPt(f.second.a, P(5, 0));
    assert.equal(filletLines(h, P(1, 0), line(P(0, 1), P(9, 1)), P(1, 1), 1), null);
    assert.equal(filletLines(h, P(1, 0), v, P(5, 4), 50), null);
  });
  it('chamfers with two distances', () => {
    const c = chamferLines(h, P(1, 0), v, P(5, 4), 1, 2);
    assert.ok(c && c.line?.type === 'line');
    nearPt(c.line.a, P(4, 0));
    nearPt(c.line.b, P(5, 2));
  });
});
