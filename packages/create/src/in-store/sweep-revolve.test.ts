/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { revolveFaces, sweepFaces } from './sweep-revolve.js';

type Vec3 = [number, number, number];

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

function planar(face: Vec3[]): boolean {
  const [a, b, c] = face;
  const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  return face.every((p) => Math.abs(n[0] * (p[0] - a[0]) + n[1] * (p[1] - a[1]) + n[2] * (p[2] - a[2])) < 1e-6);
}

const square = (s: number): [number, number][] => [[-s / 2, 0], [s / 2, 0], [s / 2, s], [-s / 2, s]];

describe('sweepFaces', () => {
  it('sweeps along a straight path: a prism', () => {
    const faces = sweepFaces(square(0.2), [[0, 0, 0], [5, 0, 0]]);
    expect(closed(faces)).toBe(true);
    expect(volume(faces)).toBeCloseTo(0.2 * 0.2 * 5, 9);
  });

  it('mitres the corners of an L path (volume along the centreline)', () => {
    const faces = sweepFaces(square(0.2), [[0, 0, 0], [4, 0, 0], [4, 3, 0]]);
    expect(closed(faces)).toBe(true);
    expect(faces.every(planar)).toBe(true);
    expect(volume(faces)).toBeCloseTo(0.04 * 7, 9);
  });

  it('wraps a closed path with no caps', () => {
    const faces = sweepFaces(square(0.2), [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]], { closed: true });
    expect(closed(faces)).toBe(true);
    expect(faces).toHaveLength(16);
    expect(volume(faces)).toBeCloseTo(0.04 * 16, 9);
  });
});

describe('revolveFaces', () => {
  it('turns a rectangle about an axis into a ring (≈ a tube)', () => {
    const faces = revolveFaces([[1, 0, 0], [2, 0, 0], [2, 0, 1], [1, 0, 1]], [0, 0, 0], [0, 0, 1], Math.PI * 2, 64);
    expect(closed(faces)).toBe(true);
    // 64-gon tube: area ratio of a regular polygon to its circle.
    const k = (64 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 64);
    expect(volume(faces)).toBeCloseTo(Math.PI * (4 - 1) * k, 6);
  });

  it('caps a partial turn, and collapses quads touching the axis', () => {
    const faces = revolveFaces([[0, 0, 0], [1, 0, 0], [1, 0, 2], [0, 0, 2]], [0, 0, 0], [0, 0, 1], Math.PI / 2, 12);
    expect(closed(faces)).toBe(true);
    expect(faces.every(planar)).toBe(true);
    expect(volume(faces)).toBeGreaterThan(0);
  });
});
