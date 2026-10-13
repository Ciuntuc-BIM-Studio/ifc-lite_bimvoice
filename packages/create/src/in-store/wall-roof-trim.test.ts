/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { gableWallLines, roofTrimDepth } from './wall-roof-trim.js';
import { defaultRoofStructure } from './roof-structure.js';

// 10 × 6 m, gables at x = 10 (edge 1) and x = 0 (edge 3), wall plate at 3 m.
const roof = {
  outline: [[0, 0], [10, 0], [10, 6], [0, 6]] as [number, number][], eaveHeight: 3,
  rules: [{ kind: 'eave' as const, pitch: 30, overhang: 0.5 }, { kind: 'gable' as const, pitch: 0, overhang: 0.3 }, { kind: 'eave' as const, pitch: 30, overhang: 0.5 }, { kind: 'gable' as const, pitch: 0, overhang: 0.3 }],
};

describe('gable walls', () => {
  it('one per gable edge, outer face `offset` inside the outline, on the wall plate', () => {
    const lines = gableWallLines(roof, 0.3, 0.1, false);
    expect(lines.map((l) => l.edge).sort()).toEqual([1, 3]);
    const east = lines.find((l) => l.edge === 1)!;
    // Axis 0.1 + 0.15 inside x = 10, along the edge's own direction.
    expect(east.start.map((v) => +v.toFixed(6))).toEqual([9.75, 0, 3]);
    expect(east.end.map((v) => +v.toFixed(6))).toEqual([9.75, 6, 3]);
    expect(east.height).toBeGreaterThan(3 * Math.tan(Math.PI / 6));
    const west = lines.find((l) => l.edge === 3)!;
    expect(west.start.map((v) => +v.toFixed(6))).toEqual([0.25, 6, 3]);
  });

  it('flipped, the same axis runs the other way (its layers mirrored)', () => {
    const [a] = gableWallLines(roof, 0.3, 0.1, false).filter((l) => l.edge === 1);
    const [b] = gableWallLines(roof, 0.3, 0.1, true).filter((l) => l.edge === 1);
    expect(b.start).toEqual(a.end);
    expect(b.end).toEqual(a.start);
  });

  it('cuts under the covering, or under the rafters or chords too', () => {
    const spec = { covering: { thickness: 0.08, color: '#000' }, structure: defaultRoofStructure() };
    expect(roofTrimDepth(spec, 'covering')).toBeCloseTo(0.08);
    expect(roofTrimDepth(spec, 'structure')).toBeCloseTo(spec.structure.coverDepth + spec.structure.rafter.depth);
    expect(roofTrimDepth({ ...spec, structure: { ...spec.structure, system: 'none' } }, 'structure')).toBeCloseTo(0.08);
  });
});
