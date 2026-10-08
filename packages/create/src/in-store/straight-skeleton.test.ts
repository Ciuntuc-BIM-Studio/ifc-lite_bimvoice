/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { hipRoofFaces } from './straight-skeleton.js';
import { roofFacets, roofSolidFaces } from './roof-surface.js';

type Vec2 = [number, number];
type Vec3 = [number, number, number];

const SHAPES: Record<string, Vec2[]> = {
  rectangle: [[0, 0], [10, 0], [10, 6], [0, 6]],
  square: [[0, 0], [4, 0], [4, 4], [0, 4]],
  L: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]],
  U: [[0, 0], [12, 0], [12, 8], [8, 8], [8, 3], [4, 3], [4, 8], [0, 8]],
  pentagon: [[0, 0], [7, -1], [9, 4], [4, 8], [-1, 5]],
  T: [[0, 6], [0, 10], [12, 10], [12, 6], [8, 6], [8, 0], [4, 0], [4, 6]],
  cross: [[4, 0], [8, 0], [8, 4], [12, 4], [12, 8], [8, 8], [8, 12], [4, 12], [4, 8], [0, 8], [0, 4], [4, 4]],
  step: [[0, 0], [10, 0], [10, 4], [14, 4], [14, 10], [4, 10], [4, 6], [0, 6]],
  skewed: [[0, 0], [10, 1], [11, 7], [6, 5], [2, 9], [-1, 4]],
};

const area = (p: Vec2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2;

function closed(faces: Vec3[][]): boolean {
  const k = (p: Vec3) => p.map((v) => v.toFixed(6)).join(',');
  const edges = new Map<string, number>();
  for (const f of faces) f.forEach((p, i) => {
    const e = `${k(p)}|${k(f[(i + 1) % f.length])}`;
    edges.set(e, (edges.get(e) ?? 0) + 1);
  });
  return [...edges].every(([e, n]) => {
    const [a, b] = e.split('|');
    return n === 1 && edges.get(`${b}|${a}`) === 1;
  });
}

function volume(faces: Vec3[][]): number {
  let v = 0;
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) {
    const [a, b, c] = [f[0], f[i], f[i + 1]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe('hipRoofFaces (straight skeleton)', () => {
  const slope = Math.PI / 6;
  const k = Math.tan(slope);

  it.each(Object.keys(SHAPES))('%s: one face per edge, each on its own pitched plane, a closed solid', (name) => {
    const raw = SHAPES[name];
    const signed = raw.reduce((s, a, i) => s + a[0] * raw[(i + 1) % raw.length][1] - raw[(i + 1) % raw.length][0] * a[1], 0);
    const outline = signed > 0 ? raw : [...raw].reverse();
    const faces = hipRoofFaces(outline, slope);
    expect(faces).toHaveLength(outline.length);
    faces.forEach((face, i) => {
      // Every point of face i is as high as pitch × its distance to edge i's line.
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n: Vec2 = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      for (const p of face) expect(p[2]).toBeCloseTo(k * ((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1]), 6);
    });
    const solid = roofSolidFaces(faces, 0.3);
    expect(closed(solid)).toBe(true);
    expect(volume(solid)).toBeCloseTo(area(outline) * 0.3, 5);
  });

  it('tops a rectangle at half its width, a square at a single apex', () => {
    const top = (o: Vec2[]) => Math.max(...hipRoofFaces(o, Math.PI / 4).flat().map((p) => p[2]));
    expect(top(SHAPES.rectangle)).toBeCloseTo(3, 9);
    expect(top(SHAPES.square)).toBeCloseTo(2, 9);
    expect(hipRoofFaces(SHAPES.square, Math.PI / 4).every((f) => f.length === 3)).toBe(true);
  });

  it('accepts the outline either way round', () => {
    const faces = hipRoofFaces([...SHAPES.L].reverse(), slope);
    expect(closed(roofSolidFaces(faces, 0.2))).toBe(true);
  });

  it('pushes the eaves out by the overhang', () => {
    const faces = roofFacets(SHAPES.L, { kind: 'hip', slope, overhang: 0.5 });
    const xs = faces.flat().map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 9);
    expect(Math.max(...xs)).toBeCloseTo(10.5, 9);
  });
});
