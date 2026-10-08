/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { roofGeometry, type RoofEdgeRule } from './roof-system.js';
import { defaultRoofStructure, roofStructure } from './roof-structure.js';

type Vec2 = [number, number];
const rect: Vec2[] = [[0, 0], [10, 0], [10, 6], [0, 6]];
const eave: RoofEdgeRule = { kind: 'eave', pitch: 30, overhang: 0.5 };
const gable: RoofEdgeRule = { kind: 'gable', pitch: 0, overhang: 0.3 };
const t30 = Math.tan(Math.PI / 6);

describe('roof structure', () => {
  it('spaces rafters along each plane, sloping from the eave to the ridge, under the covering', () => {
    const g = roofGeometry(rect, [eave, gable, eave, gable]);
    const spec = defaultRoofStructure();
    const members = roofStructure(g, spec);
    const rafters = members.filter((m) => m.role === 'rafter');
    // 10.6 m along each plane (rakes included), outer rafters flush: 10.52 m in ≈ 0.8 m spaces → 13 spaces, 14 rafters, two planes.
    expect(rafters).toHaveLength(28);
    for (const m of rafters) {
      const run = Math.hypot(m.end[0] - m.start[0], m.end[1] - m.start[1]);
      expect(Math.abs(m.end[2] - m.start[2]) / run).toBeCloseTo(t30, 6);
    }
    // Rafter top = roof surface minus the cover, measured across the slope.
    const r = rafters[0];
    const surface = (y: number) => (y <= 3 ? y * t30 : (6 - y) * t30);
    const axisDrop = (spec.coverDepth + spec.rafter.depth / 2) / Math.cos(Math.PI / 6);
    const mid = [(r.start[0] + r.end[0]) / 2, (r.start[1] + r.end[1]) / 2, (r.start[2] + r.end[2]) / 2];
    expect(surface(mid[1]) - mid[2]).toBeCloseTo(axisDrop, 2);
  });

  it('adds a ridge beam, purlins and wall plates; hips on a hip roof', () => {
    const gableRoof = roofStructure(roofGeometry(rect, [eave, gable, eave, gable]), defaultRoofStructure());
    expect(gableRoof.filter((m) => m.role === 'ridge')).toHaveLength(1);
    expect(gableRoof.filter((m) => m.role === 'purlin')).toHaveLength(2);
    expect(gableRoof.filter((m) => m.role === 'plate')).toHaveLength(2);
    const hipRoof = roofStructure(roofGeometry(rect, [eave, eave, eave, eave]), defaultRoofStructure());
    expect(hipRoof.filter((m) => m.role === 'hip')).toHaveLength(4);
    expect(hipRoof.filter((m) => m.role === 'plate')).toHaveLength(4);
    const ridge = hipRoof.find((m) => m.role === 'ridge')!;
    expect(ridge.start[2]).toBeLessThan(3 * t30);
  });

  it('frames a truss roof: top chords on the surface, a bottom chord between the walls, a king post and fink struts', () => {
    const g = roofGeometry(rect, [eave, gable, eave, gable]);
    const spec = { ...defaultRoofStructure(), system: 'trusses' as const };
    const members = roofStructure(g, spec);
    expect(members.some((m) => m.role === 'rafter' || m.role === 'purlin')).toBe(false);
    const ties = members.filter((m) => m.role === 'tie');
    // 10 m along the ridge, outer trusses flush: 9.94 m in ≈ 1.2 m spaces → 8 spaces, 9 trusses.
    expect(ties).toHaveLength(9);
    for (const t of ties) expect(Math.hypot(t.end[0] - t.start[0], t.end[1] - t.start[1])).toBeCloseTo(6, 6); // wall to wall, not to the eave
    expect(members.filter((m) => m.role === 'chord')).toHaveLength(18);
    expect(members.filter((m) => m.role === 'post')).toHaveLength(9);
    expect(members.filter((m) => m.role === 'strut')).toHaveLength(18);
    expect(members.filter((m) => m.role === 'plate')).toHaveLength(2);
    const post = members.find((m) => m.role === 'post')!;
    expect(post.end[2]).toBeGreaterThan(post.start[2] + 1);
    expect(post.end[2]).toBeLessThan(3 * t30);
    // The top chords follow the slope and start at the eave (the overhang included).
    const chord = members.find((m) => m.role === 'chord')!;
    const run = Math.hypot(chord.end[0] - chord.start[0], chord.end[1] - chord.start[1]);
    expect(run).toBeCloseTo(3.5, 2);
    expect(Math.abs(chord.end[2] - chord.start[2]) / run).toBeCloseTo(t30, 6);
    // A mono-pitch roof: trusses across the slope, no post.
    const mono = roofStructure(roofGeometry(rect, [eave, gable, gable, gable]), { ...spec, truss: { ...spec.truss!, pattern: 'king' } });
    expect(mono.filter((m) => m.role === 'tie').length).toBeGreaterThan(5);
    expect(mono.filter((m) => m.role === 'post')).toHaveLength(0);
    expect(new Set(members.map((m) => m.key)).size).toBe(members.length);
  });

  it('keeps member keys unique and generates nothing for a covering-only roof', () => {
    const members = roofStructure(roofGeometry(rect, [eave, eave, eave, eave]), defaultRoofStructure());
    expect(new Set(members.map((m) => m.key)).size).toBe(members.length);
    expect(roofStructure(roofGeometry(rect, [eave, eave, eave, eave]), { ...defaultRoofStructure(), system: 'none' })).toEqual([]);
  });
});
