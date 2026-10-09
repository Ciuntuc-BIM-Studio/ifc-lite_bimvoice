/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { abutmentSections, defaultAbutment, extrudeOutline, type CorridorBridge } from './bridge.js';
import { buildCorridor, type CorridorSolid, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign } from './assembly.js';
import { Terrain, delaunay, type V3 } from './tin.js';
import { componentFromProfile } from './components.js';
import { profileFromPreset, signedArea } from './structure-profile.js';

function volume(s: { points: V3[]; triangles: [number, number, number][] }): number {
  let v = 0;
  for (const [i, j, k] of s.triangles) {
    const a = s.points[i], b = s.points[j], c = s.points[k];
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}

function closed(s: { triangles: [number, number, number][] }) {
  const edges = new Map<string, number>();
  for (const [a, b, c] of s.triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(`${p}>${q}`, (edges.get(`${p}>${q}`) ?? 0) + 1);
  for (const [key, n] of edges) {
    expect(n).toBe(1);
    const [p, q] = key.split('>');
    expect(edges.get(`${q}>${p}`), key).toBe(1);
  }
}

/** A valley: ground at 10 m either side, falling to 0 between x = 60 and x = 140. */
const valley = () => {
  const pts: V3[] = [];
  for (let x = -20; x <= 220; x += 10) for (let y = -40; y <= 40; y += 10) pts.push([x, y, x < 60 || x > 140 ? 10 : 0]);
  return new Terrain(delaunay(pts));
};

const bridge = (): CorridorBridge => ({
  id: 'b1', name: 'Bridge 1', from: 50, to: 150,
  deck: { profileId: 'p', profile: profileFromPreset('deck-slab', 'p'), offset: [0, -0.6] },
  start: defaultAbutment('wall', 6), end: defaultAbutment('gravity', 6),
});

const spec = (over: Partial<CorridorSpec> = {}): CorridorSpec => ({
  name: 'Road', alignment: { pis: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }, profile: { pvis: [{ station: 0, elevation: 10 }, { station: 200, elevation: 10 }] },
  assembly: defaultAssembly(), design: defaultDesign(), interval: 10, ...over,
});

describe('bridges', () => {
  it('abutment sections: a wall abutment is a front wall with a back wall, a gravity one has a battered back', () => {
    const wall = abutmentSections(defaultAbutment('wall', 5), 6, 1.2);
    // Stem 1 × 6 plus back wall 0.4 × 1.2.
    expect(Math.abs(signedArea(wall.body))).toBeCloseTo(6 + 0.48, 9);
    const gravity = abutmentSections(defaultAbutment('gravity', 5), 6, 1.2);
    // Trapezoid (1.2 + 3) / 2 × 6 plus the back wall.
    expect(Math.abs(signedArea(gravity.body))).toBeCloseTo(12.6 + 0.48, 9);
    expect(Math.abs(signedArea(gravity.footing))).toBeCloseTo(4.5 * 1, 9);
  });

  it('extrudes an outline into a closed prism of area × length', () => {
    const p = extrudeOutline([[0, 0], [2, 0], [2, 1], [0, 1]], [10, 20, 5], [1, 0, 0], [0, 0, 1], [0, 1, 0], -3, 4);
    closed(p);
    expect(volume(p)).toBeCloseTo(14, 9);
  });

  it('a bridge over a valley: no earthworks on it, a deck, two abutments down to a metre under the ground on strip footings', () => {
    const model = buildCorridor(spec({ bridges: [bridge()] }), valley());
    const on = model.stations.find((s) => s.station === 100)!;
    expect([on.daylightLeft, on.daylightRight, on.cutArea, on.fillArea]).toEqual([null, null, 0, 0]);
    const keys = model.solids.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['comp:bridge:b1:deck', 'bridge:b1:start', 'bridge:b1:start-footing', 'bridge:b1:end', 'bridge:b1:end-footing']));
    const by = (k: string) => model.solids.find((s) => s.key === k)! as CorridorSolid;
    for (const k of ['bridge:b1:start', 'bridge:b1:start-footing', 'bridge:b1:end', 'bridge:b1:end-footing']) { closed(by(k)); expect(volume(by(k))).toBeGreaterThan(0); }
    expect(by('bridge:b1:end-footing').ifc).toEqual({ ifcClass: 'IfcFooting', predefinedType: 'STRIP_FOOTING', objectType: 'Abutment footing' });
    // At station 50 the ground is 10 (still the bank): seat at 10 − 0.6 − 1.2 = 8.2, footing top at 9 — the minimum height.
    // The abutments sit at the valley's edges; their footings reach a metre under the ground there.
    const zMin = (k: string) => Math.min(...by(k).points.map((p) => p[2]));
    expect(zMin('bridge:b1:start-footing')).toBeLessThan(10);
    // 12 m wide (6 + 6) plus 0.3 either side for the footing.
    const ys = by('bridge:b1:start-footing').points.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(12.6, 6);
    // The start abutment reaches back (toward lower stations), the end one forward.
    const xs = (k: string) => by(k).points.map((p) => p[0]);
    expect(Math.min(...xs('bridge:b1:start'))).toBeLessThan(50);
    expect(Math.max(...xs('bridge:b1:start'))).toBeCloseTo(50, 6);
    expect(Math.max(...xs('bridge:b1:end'))).toBeGreaterThan(150);
    // Mirrored, it turns round.
    const turned = buildCorridor(spec({ bridges: [{ ...bridge(), start: { ...bridge().start, mirror: true } }] }), valley());
    expect(Math.min(...turned.solids.find((s) => s.key === 'bridge:b1:start')!.points.map((p) => p[0]))).toBeCloseTo(50, 6);
    // Asymmetric: 2 m left, 9 m right.
    const lop = buildCorridor(spec({ bridges: [{ ...bridge(), start: { ...bridge().start, left: 2, right: 9 } }] }), valley());
    const ly = lop.solids.find((s) => s.key === 'bridge:b1:start')!.points.map((p) => p[1]);
    expect([Math.max(...ly), Math.min(...ly)].map((v) => Math.round(v * 1000) / 1000)).toEqual([2, -9]);
  });

  it('a component mirrored about its own axis lies on the other side of its insertion point, flipped hangs below it', () => {
    const kerb = profileFromPreset('kerb', 'k');
    const plain = buildCorridor(spec({ components: [componentFromProfile('k', kerb, 0, 200)] }), null).solids.find((s) => s.key === 'comp:k')!;
    const mirrored = buildCorridor(spec({ components: [{ ...componentFromProfile('k', kerb, 0, 200), mirror: true }] }), null).solids.find((s) => s.key === 'comp:k')!;
    const barrier = profileFromPreset('concrete-barrier', 'b');
    const upright = buildCorridor(spec({ components: [componentFromProfile('k', barrier, 0, 200)] }), null).solids.find((s) => s.key === 'comp:k')!;
    const flipped = buildCorridor(spec({ components: [{ ...componentFromProfile('k', barrier, 0, 200), flip: true }] }), null).solids.find((s) => s.key === 'comp:k')!;
    // Right side, road edge at y = −4.5: the kerb runs outward (y below −4.5); mirrored, inward.
    const ys = (s: CorridorSolid) => s.points.map((p) => p[1]);
    expect(Math.max(...ys(plain))).toBeCloseTo(-4.5, 6);
    expect(Math.min(...ys(mirrored))).toBeCloseTo(-4.5, 6);
    const zs = (s: CorridorSolid) => s.points.map((p) => p[2]);
    expect(Math.max(...zs(flipped))).toBeLessThan(Math.max(...zs(upright)) - 0.5);
    closed(mirrored);
    closed(flipped);
    expect(volume(mirrored)).toBeGreaterThan(0);
  });
});
