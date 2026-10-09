/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { Terrain, delaunay, parseSurveyPoints, tinFromMesh, type V3 } from './tin.js';

const grid = (n: number, z: (x: number, y: number) => number): V3[] => {
  const pts: V3[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pts.push([i * 10, j * 10, z(i * 10, j * 10)]);
  return pts;
};

describe('TIN', () => {
  it('Delaunay over a grid: 2 (n-1)² counter-clockwise triangles, every one empty of other points', () => {
    const pts = grid(5, () => 0);
    const tin = delaunay(pts);
    expect(tin.triangles).toHaveLength(32);
    for (const [i, j, k] of tin.triangles) {
      const a = tin.points[i], b = tin.points[j], c = tin.points[k];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
    // Random scatter: no point inside another triangle's circumcircle (the Delaunay property).
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const scatter: V3[] = Array.from({ length: 80 }, () => [rnd() * 100, rnd() * 100, rnd() * 5]);
    const t2 = delaunay(scatter);
    expect(t2.triangles.length).toBeGreaterThan(100);
    for (const [i, j, k] of t2.triangles) {
      const a = t2.points[i], b = t2.points[j], c = t2.points[k];
      const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
      const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
      const r2 = (a[0] - x) ** 2 + (a[1] - y) ** 2;
      for (const p of t2.points) expect((p[0] - x) ** 2 + (p[1] - y) ** 2).toBeGreaterThan(r2 * (1 - 1e-9) - 1e-6);
    }
  });

  it('interpolates a planar surface exactly and meets a slope line where it should', () => {
    const terrain = new Terrain(delaunay(grid(6, (x, y) => 100 + 0.1 * x + 0.02 * y)));
    expect(terrain.elevationAt(17, 23)).toBeCloseTo(100 + 1.7 + 0.46, 9);
    expect(terrain.elevationAt(-1, 0)).toBeNull();
    // From 3 m above the ground at (10, 10), down a 1 : 2 slope along +x: ground rises 0.1 per metre, line falls 0.5 → meets after 5 m of run.
    const hit = terrain.hit([10, 10, 100 + 1 + 0.2 + 3], [2, 0, -1], 50)!;
    expect(hit).not.toBeNull();
    expect(hit[0]).toBeCloseTo(15, 3);
    expect(hit[2]).toBeCloseTo(terrain.elevationAt(hit[0], hit[1])!, 3);
    // A line that never comes down stays off.
    expect(terrain.hit([10, 10, 200], [1, 0, 0], 20)).toBeNull();
  });

  it('reads survey points in xyz and PENZD forms, and TINs from meshes', () => {
    expect(parseSurveyPoints('# header\n1,2,3\n4 5 6\n')).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(parseSurveyPoints('7,4500.0,500.0,120.5,TREE')).toEqual([[500, 4500, 120.5]]);
    const tin = tinFromMesh([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, 0, 10, 0, 10, 10, 1], [0, 1, 2, 3, 4, 5]);
    expect(tin.points).toHaveLength(4);
    expect(tin.triangles).toHaveLength(2);
  });
});
