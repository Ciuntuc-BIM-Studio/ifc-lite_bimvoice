/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { buildCorridor, type CorridorSpec } from './corridor.js';
import { defaultAssembly, defaultDesign } from './assembly.js';
import { Terrain, delaunay, type V3 } from './tin.js';
import { profileDrawing } from './profile-drawing.js';
import { sampleStations, sectionsDrawing } from './section-drawing.js';
import { componentFromProfile } from './components.js';
import { profileFromPreset } from './structure-profile.js';

const terrain = () => {
  const pts: V3[] = [];
  for (let x = -50; x <= 300; x += 10) for (let y = -150; y <= 60; y += 10) pts.push([x, y, 1 + 0.01 * x]);
  return new Terrain(delaunay(pts));
};
const spec: CorridorSpec = {
  name: 'Road', alignment: { pis: [{ x: 0, y: 0 }, { x: 150, y: 0, radius: 60 }, { x: 150, y: -120 }] },
  profile: { pvis: [{ station: 0, elevation: 2 }, { station: 100, elevation: 3, length: 40 }, { station: 230, elevation: 2.5 }] },
  assembly: defaultAssembly(), design: defaultDesign(), interval: 10,
  components: [componentFromProfile('w', profileFromPreset('cantilever-wall', 'p'), 40, 120)],
};
const labels = { title: 'DN1', station: 'Station', ground: 'Ground', grade: 'Grade', cutFill: 'Cut/fill', geometry: 'Geometry', curve: (l: string) => `L=${l}`, radius: (r: string) => `R=${r}` };
const texts = (d: { prims: { kind: string; text?: string }[] }) => d.prims.filter((p) => p.kind === 'text').map((p) => p.text!);

describe('civil drawings', () => {
  it('profile: grid, ground and grade, the vertical curve, the curve radius, and a band column per 20 m', () => {
    const model = buildCorridor(spec, terrain());
    const d = profileDrawing(model, terrain(), { scale: 1000, vExaggeration: 10, stationStep: 20, elevationStep: 1 }, labels);
    const t = texts(d);
    expect(t).toContain('DN1');
    expect(t).toContain('L=40.0');
    expect(t).toContain('R=60.0');
    expect(t).toContain('0+100.00');
    expect(t.filter((x) => /^\d\+\d{3}\.\d\d$/.test(x)).length).toBeGreaterThanOrEqual(Math.floor(model.alignment.length / 20));
    expect(d.prims.filter((p) => p.pen === 'ground')).toHaveLength(1);
    const grade = d.prims.find((p) => p.pen === 'grade')!;
    // Exaggerated 10×: the grade rises 1 m over 100 m, so 10 drawing metres.
    if (grade.kind !== 'poly') throw new Error('grade is a polyline');
    const at = (x: number) => grade.pts.find((q) => Math.abs(q[0] - x) < 1e-6)![1];
    expect(at(60) - at(0)).toBeCloseTo(6, 6);
    expect(d.bounds.maxX).toBeGreaterThanOrEqual(model.alignment.length);
    expect(d.bounds.maxX).toBeLessThan(model.alignment.length + 2);
  });

  it('sections: one view per 20 m, laid out in columns, with courses, ground, the wall where it runs, and the areas', () => {
    const model = buildCorridor(spec, terrain());
    expect(sampleStations(model, { every: 20, stations: [] })[0]).toBe(0);
    expect(sampleStations(model, { every: 20, stations: [50, 500, 50] })).toEqual([50]);
    const d = sectionsDrawing(model, terrain(), { scale: 200, every: 20, columns: 3 }, { areas: (c, f) => `C${c} F${f}` }, spec.assembly.layers);
    const titles = texts(d).filter((x) => /^\d\+\d{3}\.\d\d$/.test(x));
    expect(titles).toHaveLength(sampleStations(model, { every: 20, stations: [] }).length);
    expect(d.prims.filter((p) => p.pen === 'course')).toHaveLength(titles.length * spec.assembly.layers.length);
    // The wall shows only in the sections between 40 and 120: 40, 60, 80, 100, 120.
    expect(d.prims.filter((p) => p.pen === 'component')).toHaveLength(5);
    expect(texts(d).some((x) => /^C\d+\.\d\d F\d+\.\d\d$/.test(x))).toBe(true);
  });
});
