/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, finishedGradeSurface, triangulatePolygon, type CorridorSolid, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign, requiredSuperelevation, slopesAt } from './assembly.js';
import { buildAlignment } from './alignment.js';
import { Terrain, delaunay, type V3 } from './tin.js';

const flat = (z: number) => {
  const pts: V3[] = [];
  for (let x = -100; x <= 400; x += 50) for (let y = -100; y <= 300; y += 50) pts.push([x, y, z]);
  return new Terrain(delaunay(pts));
};

const spec = (over: Partial<CorridorSpec> = {}): CorridorSpec => ({
  name: 'Road', alignment: { pis: [{ x: 0, y: 0 }, { x: 200, y: 0, radius: 80 }, { x: 200, y: 200 }] },
  profile: { pvis: [{ station: 0, elevation: 1 }, { station: 400, elevation: 1 }] }, assembly: defaultAssembly(), design: defaultDesign(), interval: 10, ...over,
});

/** A closed shell: every edge shared by exactly two triangles, in opposite directions. */
function expectClosed(solid: CorridorSolid) {
  const edges = new Map<string, number>();
  for (const [a, b, c] of solid.triangles) {
    for (const [p, q] of [[a, b], [b, c], [c, a]]) edges.set(`${p}>${q}`, (edges.get(`${p}>${q}`) ?? 0) + 1);
  }
  for (const [key, n] of edges) {
    expect(n).toBe(1);
    const [p, q] = key.split('>');
    expect(edges.get(`${q}>${p}`)).toBe(1);
  }
}

describe('corridor', () => {
  it('a road a metre above flat ground is all fill: closed courses, a fill surface, volumes', () => {
    const model = buildCorridor(spec(), flat(0));
    expect(model.stations.length).toBeGreaterThan(30);
    expect(model.solids.map((s) => s.key)).toEqual(['course:0', 'course:1', 'course:2', 'course:3', 'fill']);
    for (const s of model.solids.filter((s) => s.closed)) expectClosed(s);
    expect(model.stations.every((s) => s.kindLeft === 'fill' && s.kindRight === 'fill')).toBe(true);
    // The daylight point sits on the ground, 1.5 m out per metre of height: 1 m (grade) + the shoulder's fall.
    const first = model.stations[0];
    expect(first.daylightRight![2]).toBeCloseTo(0, 6);
    const edge = first.top[first.top.length - 1];
    expect(Math.hypot(first.daylightRight![0] - edge[0], first.daylightRight![1] - edge[1])).toBeCloseTo(edge[2] * 1.5, 6);
    expect(model.volumes.cut).toBeCloseTo(0, 6);
    // Fill: the width (9 m) × the subgrade's height (1 m grade − 0.6 m of courses, less the cross fall) plus the two side wedges, per metre of length.
    const perMetre = model.volumes.fill / model.alignment.length;
    expect(perMetre).toBeGreaterThan(9 * 0.3);
    expect(perMetre).toBeLessThan(9 * 0.4 + 2 * 0.5 * 1 * 1.5);
  });

  it('a road through a hill is cut, and without a terrain the embankment is nominal', () => {
    const cut = buildCorridor(spec({ profile: { pvis: [{ station: 0, elevation: -2 }, { station: 400, elevation: -2 }] } }), flat(0));
    expect(cut.solids.map((s) => s.key)).toContain('cut');
    expect(cut.volumes.cut).toBeGreaterThan(0);
    expect(cut.volumes.fill).toBeCloseTo(0, 6);
    const none = buildCorridor(spec(), null);
    expect(none.stations[0].kindRight).toBe('none');
    expect(none.stations[0].daylightRight![2]).toBeCloseTo(none.stations[0].top.at(-1)![2] - 1, 9);
    expect(none.volumes).toEqual({ cut: 0, fill: 0 });
  });

  it('superelevates the outer side through the curve', () => {
    const a = buildAlignment(spec().alignment);
    const e = requiredSuperelevation(80, defaultDesign());
    expect(e).toBeGreaterThan(2.5);
    const arc = a.segments.find((s) => s.kind === 'arc')!;
    const mid = slopesAt(a, defaultAssembly(), defaultDesign(), arc.station + arc.length / 2);
    // Left turn: the right side rises at +e, the left falls at -e.
    expect(mid.right).toBeCloseTo(e, 9);
    expect(mid.left).toBeCloseTo(-e, 9);
    expect(slopesAt(a, defaultAssembly(), defaultDesign(), 5)).toEqual({ left: -2.5, right: -2.5 });
    expect(requiredSuperelevation(5000, defaultDesign())).toBe(0);
  });

  it('triangulates section polygons and exports the finished grade as a surface', () => {
    expect(triangulatePolygon([[0, 0], [4, 0], [4, 1], [2, 0.5], [0, 1]])).toHaveLength(3);
    const model = buildCorridor(spec(), null);
    const surface = finishedGradeSurface(model);
    expect(surface.points.length).toBe(model.stations.length * model.stations[0].top.length);
    expect(surface.triangles.length).toBe((model.stations.length - 1) * (model.stations[0].top.length - 1) * 2);
  });
});
