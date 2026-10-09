/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { abutmentProfile, abutmentSections, defaultAbutment, defaultBearings, defaultPier, distributePiers, extrudeOutline, type AbutmentSpec, type CorridorBridge } from './bridge.js';
import { segmentGrades, withSegmentGrade } from './profile.js';
import { buildCorridor, type CorridorSolid, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign } from './assembly.js';
import { Terrain, delaunay, type V3 } from './tin.js';
import { componentFromProfile } from './components.js';
import { profileFromPreset, signedArea, toCustomProfile } from './structure-profile.js';

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
    // The back wall follows the deck; with no height given the preset's own (6 m) stands.
    expect(Math.max(...abutmentSections(defaultAbutment('wall', 5), null, 2).body.map((q) => q[1]))).toBeCloseTo(2, 9);
    expect(Math.min(...abutmentSections(defaultAbutment('wall', 5), null, 2).body.map((q) => q[1]))).toBeCloseTo(-6, 9);
  });

  it('a drawn abutment profile stretches below the seat to the height; an old typed abutment reads as its preset', () => {
    const custom = { ...defaultAbutment('wall', 5), profile: toCustomProfile({ ...profileFromPreset('wall-abutment', 'c'), outer: [[0, -4], [2, -4], [2, 1], [0, 0]] }) };
    const s = abutmentSections(custom, 8, 1.2);
    expect(s.body).toEqual([[0, -8], [2, -8], [2, 1], [0, 0]]);
    // The footing sits under the body's lowest edge.
    expect(Math.max(...s.footing.map((q) => q[1]))).toBeCloseTo(-8, 9);
    const old = { type: 'gravity', left: 5, right: 5, stem: 1.5, base: 4, backwall: 0.4, footing: { width: 5, thickness: 1, toe: 0.5 } } as unknown as AbutmentSpec;
    const p = abutmentProfile(old);
    expect(p.preset).toEqual({ id: 'gravity-abutment', params: expect.objectContaining({ stem: 1.5, base: 4 }) });
  });

  it('the bridge in elevation: the deck between the abutments, each reaching back into its bank, the ground under it', () => {
    const el = buildCorridor(spec({ bridges: [bridge()] }), valley()).bridgeElevation('b1')!;
    const xs = el.deck.map((p) => p[0]);
    // The deck reaches back over each seat to the back wall, less a 5 cm joint (seats 0.6 and 0.8 m).
    expect(Math.min(...xs)).toBeCloseTo(49.45, 6);
    expect(Math.max(...xs)).toBeCloseTo(150.75, 6);
    expect(Math.max(...el.abutments[0].body.map((p) => p[0]))).toBeCloseTo(50, 9);
    expect(Math.min(...el.abutments[1].body.map((p) => p[0]))).toBeCloseTo(150, 9);
    expect(el.ground.some(([, z]) => z < 1)).toBe(true);
    expect(el.abutments[0].height).toBeGreaterThanOrEqual(0.5);
  });

  it('grades per tangent: setting one moves its PVI and every later one, keeping the later grades', () => {
    const pvis = [{ station: 0, elevation: 10 }, { station: 100, elevation: 12 }, { station: 200, elevation: 11 }];
    expect(segmentGrades(pvis).map((g) => Math.round(g * 100) / 100)).toEqual([2, -1]);
    const next = withSegmentGrade(pvis, 1, -3);
    expect(next.map((p) => p.elevation)).toEqual([10, 7, 6]);
    expect(segmentGrades(next).map((g) => Math.round(g * 100) / 100)).toEqual([-3, -1]);
  });

  it('a deck tilted in its own plane: its right edge rises by the cross-fall', () => {
    const tilted = buildCorridor(spec({ bridges: [{ ...bridge(), deck: { ...bridge().deck, tilt: 4 } }] }), valley());
    const [loop] = tilted.componentsAt(100).find((c) => c.id === 'bridge:b1:deck')!.loops;
    const at = (x: number) => loop.filter((p) => Math.abs(p[0] - x) < 0.05).map((p) => p[1]);
    const right = Math.max(...loop.map((p) => p[0])), left = Math.min(...loop.map((p) => p[0]));
    // 11 m wide deck: the right top edge is 0.44 m above the left one.
    expect(Math.max(...at(right)) - Math.max(...at(left))).toBeCloseTo(0.44, 1);
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

  it('piers, bearings and quarter cones: closed supports under the deck, bearings on every seat, cones of fill at the abutments', () => {
    const b: CorridorBridge = { ...bridge(), piers: [defaultPier('p1', 100, 6), defaultPier('p2', 120, 6, 'wall')], bearings: defaultBearings() };
    const model = buildCorridor(spec({ bridges: [b] }), valley());
    const by = (k: string) => model.solids.find((s) => s.key === `bridge:b1:${k}`) as CorridorSolid;
    for (const k of ['pier:p1', 'pier:p1-cap', 'pier:p1-footing', 'pier:p2', 'pier:p2-footing', 'bearings:start', 'bearings:pier:p1', 'bearings:end']) { closed(by(k)); expect(volume(by(k)), k).toBeGreaterThan(0); }
    expect(by('pier:p2-cap')).toBeUndefined();
    expect(by('pier:p1').ifc).toEqual({ ifcClass: 'IfcColumn', predefinedType: 'PIERSTEM', objectType: 'Pier' });
    // Pier 1 (in the valley, ground 0): a metre under the ground, its top 0.15 m under the soffit (10 − 0.6 − 1.2).
    const zs = (k: string) => by(k).points.map((p) => p[2]);
    expect(Math.min(...zs('pier:p1'))).toBeCloseTo(-1, 6);
    expect(Math.max(...zs('pier:p1-cap'))).toBeCloseTo(8.2 - 0.15, 6);
    // Four pads a line, each 0.5 × 0.4 × 0.15.
    expect(volume(by('bearings:pier:p1'))).toBeCloseTo(4 * 0.5 * 0.4 * 0.15, 6);
    // Abutments' seats drop by the bearings; their back wall still reaches the deck's top.
    expect(Math.max(...zs('start'))).toBeCloseTo(9.4, 6);
    // Cones: fill surfaces beside the abutments, with a fill volume.
    const without = buildCorridor(spec({ bridges: [{ ...b, start: { ...b.start, cones: false }, end: { ...b.end, cones: false } }] }), valley());
    expect(model.volumes.fill).toBeGreaterThan(without.volumes.fill);
    // The cross-section through pier 1 cuts its columns, cap and footing.
    const cut = model.componentsAt(100).map((c) => c.id);
    expect(cut).toEqual(expect.arrayContaining(['bridge:b1:deck', 'bridge:b1:pier:p1', 'bridge:b1:pier:p1-cap', 'bridge:b1:pier:p1-footing', 'bridge:b1:bearings:1']));
    expect(model.componentsAt(100).find((c) => c.id === 'bridge:b1:pier:p1')!.loops).toHaveLength(defaultPier('x', 0, 6).columns);
    // Through the start abutment, half a metre behind its face: the wall from the seat down, its footing.
    expect(model.componentsAt(49.5).map((c) => c.id)).toEqual(expect.arrayContaining(['bridge:b1:start', 'bridge:b1:start-footing']));
    const el = model.bridgeElevation('b1')!;
    expect([el.piers.length, el.bearings.length, el.cones.length]).toEqual([2, 4, 4]);
  });

  it('distributes piers into equal spans', () => {
    let n = 0;
    expect(distributePiers(bridge(), 4, 6, () => `p${++n}`).map((p) => p.station)).toEqual([75, 100, 125]);
  });
});
