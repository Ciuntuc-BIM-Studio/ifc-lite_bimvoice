/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { parseXml, readLandXml, writeLandXml } from './landxml.js';
import { buildAlignment, type HorizontalAlignmentSpec } from './alignment.js';
import { delaunay, type V3 } from './tin.js';

describe('LandXML exchange', () => {
  it('parses elements, attributes, text and self-closing tags', () => {
    const root = parseXml('<?xml version="1.0"?><a x="1" y=\'two\'><b>hi &amp; bye</b><c/><!-- no --></a>');
    const a = root.children[0];
    expect(a.name).toBe('a');
    expect(a.attrs).toEqual({ x: '1', y: 'two' });
    expect(a.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(a.children[0].text).toBe('hi & bye');
  });

  it('round-trips an alignment with spirals, its profile and a surface', () => {
    const spec: HorizontalAlignmentSpec = { pis: [{ x: 10, y: 20 }, { x: 310, y: 20, radius: 150, spiralIn: 60, spiralOut: 40 }, { x: 310, y: -280, radius: 100 }, { x: 110, y: -480, radius: 90 }, { x: -90, y: -480 }], startStation: 500 };
    const profile = { pvis: [{ station: 500, elevation: 100 }, { station: 800, elevation: 106, length: 100 }, { station: 1100, elevation: 102 }] };
    const pts: V3[] = [];
    for (let x = 0; x <= 40; x += 20) for (let y = 0; y <= 40; y += 20) pts.push([x, y, x * 0.1]);
    const xml = writeLandXml({ surfaces: [{ name: 'EG', tin: delaunay(pts) }], alignments: [{ name: 'Road A', spec, profile }] });
    expect(xml).toContain('<Spiral length="60" radiusStart="INF" radiusEnd="150" rot="cw"');
    expect(xml).toContain('<Curve rot="cw" radius="150"');
    expect(xml).toContain('<ParaCurve length="100">800 106</ParaCurve>');
    // Northing before easting.
    expect(xml).toContain('<Start>20 10</Start>');
    const back = readLandXml(xml);
    expect(back.surfaces[0].tin.points).toHaveLength(9);
    expect(back.surfaces[0].tin.triangles).toHaveLength(8);
    const [a] = back.alignments;
    expect(a.name).toBe('Road A');
    expect(a.warnings).toEqual([]);
    expect(a.spec.startStation).toBe(500);
    expect(a.spec.pis).toHaveLength(5);
    a.spec.pis.forEach((pi, i) => {
      expect(pi.x).toBeCloseTo(spec.pis[i].x, 3);
      expect(pi.y).toBeCloseTo(spec.pis[i].y, 3);
      expect(pi.radius ?? 0).toBeCloseTo(spec.pis[i].radius ?? 0, 3);
      expect(pi.spiralIn ?? 0).toBeCloseTo(spec.pis[i].spiralIn ?? 0, 3);
      expect(pi.spiralOut ?? 0).toBeCloseTo(spec.pis[i].spiralOut ?? 0, 3);
    });
    expect(buildAlignment(a.spec).length).toBeCloseTo(buildAlignment(spec).length, 2);
    expect(a.profile).toEqual(profile);
  });

  it('reads a Civil 3D style alignment of lines and a curve with a PI', () => {
    const xml = `<?xml version="1.0"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Alignments><Alignment name="L1" staStart="0" length="1">
      <CoordGeom><Line><Start>0 0</Start><End>0 100</End></Line>
      <Curve rot="cw" radius="100"><Start>0 100</Start><Center>100 100</Center><End>100 200</End><PI>0 200</PI></Curve>
      <Line><Start>100 200</Start><End>100 400</End></Line></CoordGeom></Alignment></Alignments></LandXML>`;
    const [a] = readLandXml(xml).alignments;
    // LandXML northing easting: the PI (0 200) is x = 200, y = 0.
    expect(a.spec.pis).toEqual([{ x: 0, y: 0 }, { x: 200, y: 0, radius: 100, spiralIn: undefined, spiralOut: undefined }, { x: 400, y: 100 }]);
    expect(buildAlignment(a.spec).segments.map((s) => s.kind)).toEqual(['line', 'arc', 'line']);
  });
});
