/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign } from './assembly.js';
import { componentFromProfile } from './components.js';
import { PRESET_IDS, profileFromPreset } from './structure-profile.js';

const spec = (): CorridorSpec => {
  const pergola = componentFromProfile('p1', profileFromPreset('timber-pergola', 'lib-1'), 10, 40);
  return {
    name: 'Path', alignment: { pis: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    profile: { pvis: [{ station: 0, elevation: 1 }, { station: 100, elevation: 2 }] },
    assembly: defaultAssembly(), design: defaultDesign(), interval: 5, components: [pergola],
  };
};

describe('pergola', () => {
  it('is offered instead of the tunnels, which stay readable', () => {
    expect(PRESET_IDS).toContain('timber-pergola');
    expect(PRESET_IDS).not.toContain('box-tunnel');
    expect(profileFromPreset('box-tunnel', 'old').kind).toBe('tunnel');
  });

  it('builds posts both sides, a beam along each row and joists across, as columns and beams', () => {
    const model = buildCorridor(spec(), null);
    const parts = model.solids.filter((s) => s.key.startsWith('comp:p1:'));
    const posts = parts.filter((s) => s.ifc?.ifcClass === 'IfcColumn');
    const beams = parts.filter((s) => s.ifc?.predefinedType === 'BEAM');
    const joists = parts.filter((s) => s.ifc?.predefinedType === 'JOIST');
    // 30 m at ≤ 3 m: 11 posts a row, 2 rows.
    expect(posts).toHaveLength(22);
    expect(beams).toHaveLength(2);
    // (30 − 0.05) m at ≤ 0.6 m: 50 spaces, 51 joists.
    expect(joists).toHaveLength(51);
    expect(model.solids.some((s) => s.key === 'comp:p1')).toBe(false);
    // The posts stand on the grade (1 % over the path) and reach the clear height.
    const first = posts[0].points.map((p) => p[2]);
    expect(Math.min(...first)).toBeCloseTo(1.1, 6);
    expect(Math.max(...first)).toBeCloseTo(1.1 + 2.4, 6);
    // Posts either side of the 3 m clear width: their inner faces at ±1.5 m.
    const ys = posts.flatMap((s) => s.points.map((p) => p[1]));
    expect(Math.min(...ys.map(Math.abs))).toBeCloseTo(1.5, 6);
    // The joists overhang the posts by 0.3 m: ±(1.5 + 0.15 + 0.3).
    const jy = joists[0].points.map((p) => p[1]);
    expect(Math.max(...jy)).toBeCloseTo(1.95, 6);
    expect(Math.min(...jy)).toBeCloseTo(-1.95, 6);
  });
});
