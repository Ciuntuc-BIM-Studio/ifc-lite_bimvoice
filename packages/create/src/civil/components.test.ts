/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, type CorridorSolid, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign } from './assembly.js';
import { Terrain, delaunay, type V3 } from './tin.js';
import { componentFromProfile } from './components.js';
import { profileArea, profileFromPreset } from './structure-profile.js';

const ground = (z: (x: number, y: number) => number) => {
  const pts: V3[] = [];
  for (let x = -50; x <= 250; x += 10) for (let y = -60; y <= 60; y += 10) pts.push([x, y, z(x, y)]);
  return new Terrain(delaunay(pts));
};

const straight = (components: CorridorSpec['components']): CorridorSpec => ({
  name: 'Road', alignment: { pis: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }, profile: { pvis: [{ station: 0, elevation: 0 }, { station: 200, elevation: 0 }] },
  assembly: defaultAssembly(), design: defaultDesign(), interval: 10, components,
});

function volume(s: CorridorSolid): number {
  let v = 0;
  for (const [i, j, k] of s.triangles) {
    const a = s.points[i], b = s.points[j], c = s.points[k];
    v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return v / 6;
}

function expectClosed(s: CorridorSolid) {
  const edges = new Map<string, number>();
  for (const [a, b, c] of s.triangles) for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(`${p}>${q}`, (edges.get(`${p}>${q}`) ?? 0) + 1);
  for (const [key, n] of edges) {
    expect(n).toBe(1);
    const [p, q] = key.split('>');
    expect(edges.get(`${q}>${p}`), key).toBe(1);
  }
}

describe('corridor components', () => {
  it('a box tunnel on the axis is a closed shell of its section area × its length, and takes away both slopes', () => {
    const tunnel = profileFromPreset('box-tunnel', 'p');
    const comp = componentFromProfile('t', tunnel, 50, 150);
    expect(comp).toMatchObject({ side: 'centre', daylight: 'both' });
    const model = buildCorridor(straight([comp]), ground(() => 8));
    const solid = model.solids.find((s) => s.key === 'comp:t')!;
    expect(solid.ifc).toEqual({ ifcClass: 'IfcBuildingElementProxy', predefinedType: 'USERDEFINED', objectType: 'Tunnel lining' });
    expectClosed(solid);
    expect(volume(solid)).toBeCloseTo(profileArea(tunnel) * 100, 3);
    const inside = model.stations.find((s) => s.station === 100)!;
    expect([inside.daylightLeft, inside.daylightRight]).toEqual([null, null]);
    const outside = model.stations.find((s) => s.station === 20)!;
    expect(outside.kindLeft).toBe('cut');
    // Its section at 100: the lining loops, the hole included, around the axis.
    const [cut] = model.componentsAt(100);
    expect(cut.loops).toHaveLength(2);
    expect(Math.min(...cut.loops[0].map((p) => p[0]))).toBeCloseTo(-5.6, 9);
  });

  it('a retaining wall on the right of a cut grows to the ground and replaces that side slope only', () => {
    const wall = profileFromPreset('cantilever-wall', 'w');
    const comp = { ...componentFromProfile('w', wall, 40, 160), autoHeight: true };
    // Ground rising to the right: 0.1 per metre across.
    const model = buildCorridor(straight([comp]), ground((_x, y) => Math.max(0, -y * 0.1)));
    const solid = model.solids.find((s) => s.key === 'comp:w')!;
    expect(solid.ifc).toMatchObject({ ifcClass: 'IfcWall', predefinedType: 'RETAININGWALL' });
    expectClosed(solid);
    expect(volume(solid)).toBeGreaterThan(0);
    const st = model.stations.find((s) => s.station === 100)!;
    expect(st.daylightRight).toBeNull();
    expect(st.daylightLeft).not.toBeNull();
    // The wall's top reaches the ground behind it: its highest point sits on the terrain there.
    const top = Math.max(...solid.points.filter((p) => Math.abs(p[0] - 100) < 1e-6).map((p) => p[2]));
    // Back of the wall: the shoulder edge (4.5 m right, y = -4.5) plus the heel (2.2 - 0.6): ground 0.1 × 6.1.
    expect(top).toBeCloseTo(0.61, 6);
    // The right edge of the road sits on the wall's front face.
    const edge = st.top[st.top.length - 1];
    expect(solid.points.some((p) => Math.abs(p[0] - edge[0]) < 1e-6 && Math.abs(p[1] - edge[1]) < 1e-6)).toBe(true);
  });

  it('a component out of the road range, or of no length, makes nothing', () => {
    const k = profileFromPreset('kerb', 'k');
    const model = buildCorridor(straight([componentFromProfile('a', k, 300, 400), componentFromProfile('b', k, 50, 50)]), null);
    expect(model.solids.filter((s) => s.kind === 'component')).toHaveLength(0);
    expect(buildCorridor(straight([componentFromProfile('c', k, 0, 200)]), null).solids.filter((s) => s.kind === 'component')).toHaveLength(1);
  });
});
