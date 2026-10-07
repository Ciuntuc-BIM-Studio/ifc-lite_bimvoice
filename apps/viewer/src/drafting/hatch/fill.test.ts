/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { Pt } from '../types.js';
import type { HatchLineFamily, HatchPattern } from './pattern.js';
import { hatchSegments, type HatchSegment } from './fill.js';
import { builtInPatterns, findPattern } from './library.js';

function sq(x: number, y: number, size: number, cw = false): Pt[] {
  const pts = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  return cw ? pts.reverse() : pts;
}

function fam(angleDeg: number, deltaY: number, dashes: number[] = [], deltaX = 0, origin: Pt = { x: 0, y: 0 }): HatchLineFamily {
  return { angleDeg, origin, deltaX, deltaY, dashes };
}

function pat(...families: HatchLineFamily[]): HatchPattern {
  return { name: 'T', description: '', families };
}

function totalLength(segs: readonly HatchSegment[]): number {
  return segs.reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0);
}

const E = 1e-9;
function inBox(p: Pt, x0: number, y0: number, x1: number, y1: number): boolean {
  return p.x >= x0 - E && p.x <= x1 + E && p.y >= y0 - E && p.y <= y1 + E;
}

describe('hatchSegments', () => {
  const square = sq(0, 0, 10);

  it('45° lines stay inside a square and cover area/spacing', () => {
    const { segments, truncated } = hatchSegments([square], pat(fam(45, 1)), { scale: 1, angleDeg: 0 });
    assert.equal(truncated, false);
    assert.ok(segments.length > 10);
    for (const s of segments) {
      assert.ok(inBox(s.a, 0, 0, 10, 10) && inBox(s.b, 0, 0, 10, 10), 'segment outside the square');
    }
    const len = totalLength(segments);
    assert.ok(Math.abs(len - 100) / 100 < 0.05, `length ${len}`);
  });

  it('scale multiplies spacing', () => {
    const { segments } = hatchSegments([square], pat(fam(0, 1)), { scale: 0.5, angleDeg: 0 });
    const len = totalLength(segments);
    assert.ok(Math.abs(len - 200) / 200 < 0.06, `length ${len}`);
  });

  it('horizontal lines through polygon vertices do not flip intervals', () => {
    // Lines at y = 0..10 pass exactly through the square's corners and edges.
    const { segments } = hatchSegments([square], pat(fam(0, 1)), { scale: 1, angleDeg: 0 });
    for (const s of segments) {
      assert.ok(Math.abs(s.a.y - s.b.y) < E);
      assert.ok(inBox(s.a, 0, 0, 10, 10) && inBox(s.b, 0, 0, 10, 10));
    }
    // Diamond: lines pass exactly through its left/right vertices.
    const diamond = [{ x: 0, y: -5 }, { x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 }];
    const d = hatchSegments([diamond], pat(fam(0, 1)), { scale: 1, angleDeg: 0 });
    const mid = d.segments.find((s) => Math.abs(s.a.y) < E);
    assert.ok(mid);
    assert.ok(Math.abs(Math.abs(mid.b.x - mid.a.x) - 10) < 1e-9);
    assert.ok(Math.abs(totalLength(d.segments) - 50) < 1e-9);
  });

  it('a centered hole gets no strokes', () => {
    const hole = sq(3, 3, 4, true);
    const { segments } = hatchSegments([square, hole], pat(fam(45, 0.7), fam(0, 0.5)), { scale: 1, angleDeg: 0 });
    assert.ok(segments.length > 0);
    for (const s of segments) {
      const m = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      assert.ok(!(m.x > 3 + E && m.x < 7 - E && m.y > 3 + E && m.y < 7 - E), 'midpoint in hole');
    }
    const len = totalLength(segments.filter((s) => Math.abs(s.a.y - s.b.y) < E));
    assert.ok(Math.abs(len - 84 / 0.5) / (84 / 0.5) < 0.03, `length ${len}`);
  });

  it('nested island inside a hole is filled again (even-odd)', () => {
    const hole = sq(2, 2, 6);
    const island = sq(4, 4, 2);
    const { segments } = hatchSegments([square, hole, island], pat(fam(0, 0.25)), { scale: 1, angleDeg: 0 });
    const inIsland = segments.filter((s) => s.a.x >= 4 - E && s.b.x <= 6 + E && s.a.y > 4 && s.a.y < 6);
    assert.ok(inIsland.length > 0);
  });

  it('dashes leave gaps in the right ratio', () => {
    const { segments } = hatchSegments([square], pat(fam(0, 1, [0.3, -0.2])), { scale: 1, angleDeg: 0 });
    const len = totalLength(segments);
    const expected = 100 * 0.6; // 10 lines (y = 10 is excluded by the half-open rule)
    assert.ok(Math.abs(len - expected) / expected < 0.05, `length ${len}`);
    for (const s of segments) assert.ok(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) <= 0.3 + E);
  });

  it('dots produce zero-length segments', () => {
    const { segments } = hatchSegments([square], pat(fam(0, 1, [0, -1])), { scale: 1, angleDeg: 0, origin: { x: 0.5, y: 0.5 } });
    assert.ok(segments.length > 50);
    for (const s of segments) assert.deepEqual(s.a, s.b);
    assert.equal(segments.length, 100);
  });

  it('deltaX shifts the dash phase of successive lines', () => {
    const { segments } = hatchSegments([sq(0, 0, 4)], pat(fam(0, 1, [1, -1], 1)), { scale: 1, angleDeg: 0, origin: { x: 0, y: 0.5 } });
    const row0 = segments.filter((s) => Math.abs(s.a.y - 0.5) < E).map((s) => s.a.x).sort((a, b) => a - b);
    const row1 = segments.filter((s) => Math.abs(s.a.y - 1.5) < E).map((s) => s.a.x).sort((a, b) => a - b);
    assert.deepEqual(row0, [0, 2]);
    assert.deepEqual(row1, [1, 3]);
  });

  it('rotating 90° turns horizontal lines vertical', () => {
    const { segments } = hatchSegments([square], pat(fam(0, 1)), { scale: 1, angleDeg: 90 });
    assert.ok(segments.length > 5);
    for (const s of segments) {
      assert.ok(Math.abs(s.a.x - s.b.x) < 1e-9);
      assert.ok(Math.abs(s.a.y - s.b.y) > 9.99);
    }
  });

  it('truncates at maxSegments', () => {
    const r = hatchSegments([square], pat(fam(0, 0.1)), { scale: 1, angleDeg: 0, maxSegments: 5 });
    assert.equal(r.truncated, true);
    assert.equal(r.segments.length, 5);
  });

  it('skips zero-spacing families and solid patterns', () => {
    assert.equal(hatchSegments([square], pat(fam(0, 0)), { scale: 1, angleDeg: 0 }).segments.length, 0);
    const solid = findPattern('SOLID');
    assert.ok(solid);
    assert.equal(hatchSegments([square], solid, { scale: 1, angleDeg: 0 }).segments.length, 0);
    assert.equal(hatchSegments([square], pat(fam(0, 1, [-1])), { scale: 1, angleDeg: 0 }).segments.length, 0);
  });

  it('every built-in pattern hatches a 100 mm square within the square', () => {
    const box = sq(0, 0, 100);
    for (const p of builtInPatterns()) {
      const r = hatchSegments([box], p, { scale: 1, angleDeg: 15, origin: { x: 3, y: 7 } });
      assert.equal(r.truncated, false, p.name);
      if (p.solid) continue;
      assert.ok(r.segments.length > 0, `${p.name} produced nothing`);
      for (const s of r.segments) assert.ok(inBox(s.a, 0, 0, 100, 100) && inBox(s.b, 0, 0, 100, 100), p.name);
    }
  });
});
