/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { roofGeometry, type RoofEdgeRule } from './roof-system.js';
import { defaultRoofStructure, roofStructure } from './roof-structure.js';
import { memberSolidFaces, pruneOverrides, shapeMembers } from './roof-overrides.js';

type Vec3 = [number, number, number];
const eave: RoofEdgeRule = { kind: 'eave', pitch: 30, overhang: 0.5 };
const gable: RoofEdgeRule = { kind: 'gable', pitch: 0, overhang: 0.3 };

/** Signed volume of a closed shell (divergence theorem); positive when faces wind outward. */
function volume(faces: Vec3[][]): number {
  let v = 0;
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) {
    const [a, b, c] = [f[0], f[i], f[i + 1]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

describe('roof part overrides', () => {
  it('builds a member solid wound outward, its ends cut square, plumb or level', () => {
    const sloped = { start: [0, 0, 0] as Vec3, end: [3, 0, 3 * Math.tan(Math.PI / 6)] as Vec3, width: 0.1, depth: 0.2 };
    const len = Math.hypot(3, 3 * Math.tan(Math.PI / 6));
    expect(volume(memberSolidFaces({ ...sloped, startCut: 'square', endCut: 'square' }))).toBeCloseTo(0.1 * 0.2 * len, 6);
    // A plumb cut keeps the volume of a parallelogram prism around the same axis length.
    const plumb = memberSolidFaces({ ...sloped, startCut: 'plumb', endCut: 'plumb' });
    expect(volume(plumb)).toBeCloseTo(0.1 * 0.2 * len, 6);
    // The plumb end face is vertical: all its points share x.
    const end = plumb[1];
    for (const p of end) expect(p[0]).toBeCloseTo(3, 9);
    const level = memberSolidFaces({ ...sloped, startCut: 'level', endCut: 'square' });
    for (const p of level[0]) expect(p[2]).toBeCloseTo(0, 9);
  });

  it("applies deletions, sections, extensions and cuts, and the structure's rafter ends", () => {
    const g = roofGeometry([[0, 0], [10, 0], [10, 6], [0, 6]], [eave, gable, eave, gable]);
    const structure = { ...defaultRoofStructure(), rafterEnds: { eave: 'plumb' as const, ridge: 'plumb' as const } };
    const members = roofStructure(g, structure);
    const rafter = members.find((m) => m.role === 'rafter')!;
    const purlin = members.find((m) => m.role === 'purlin')!;
    const shaped = shapeMembers(members, structure, {
      [rafter.key]: { extendStart: 0.3, width: 0.12, endCut: 'level' },
      [purlin.key]: { deleted: true },
    });
    expect(shaped).toHaveLength(members.length - 1);
    const r = shaped.find((m) => m.key === rafter.key)!;
    const len = (m: { start: Vec3; end: Vec3 }) => Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1], m.end[2] - m.start[2]);
    expect(len(r)).toBeCloseTo(len(rafter) + 0.3, 9);
    expect(r).toMatchObject({ width: 0.12, startCut: 'plumb', endCut: 'level' });
    // Purlins are not rafters: square ends whatever the structure says.
    expect(shaped.find((m) => m.role === 'purlin')?.startCut).toBe('square');
  });

  it('drops overrides of parts no longer generated, and empty ones', () => {
    expect(pruneOverrides({ a: { deleted: true }, b: { width: 0.1 }, c: {} }, new Set(['a', 'c']))).toEqual({ a: { deleted: true } });
    expect(pruneOverrides({ a: { deleted: false } }, new Set(['a']))).toBeUndefined();
  });
});
