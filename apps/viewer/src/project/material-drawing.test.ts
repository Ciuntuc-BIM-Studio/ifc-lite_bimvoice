/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A cut drawn by building materials: two walls in line, each concrete, a
 * 0.2 mm PE foil and mineral wool. Each band takes its material's hatch; the
 * lines where the two walls' bands of one material meet go; the foil (too
 * thin for a band) draws as a membrane line on the concrete / wool interface.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Drawing2D, DrawingLine, DrawingPolygon } from '@ifc-lite/drawing-2d';
import { coincide, materialDrawing, type LayerRef, type MaterialResolver } from './material-drawing';
import { guessMaterial, materialGraphics } from './materials';
import { styledDrawing, cutHatches } from './view-graphics';

const NAMES: Record<number, string> = { 10: 'Concrete C25/30', 11: 'PE foil', 12: 'Mineral wool', 13: 'Bitumen membrane' };

const band = (entityId: number, materialId: number, x0: number, x1: number, y0: number, y1: number): DrawingPolygon => ({
  polygon: { outer: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], holes: [] },
  entityId, ifcType: 'IfcWall', modelIndex: 0, isCut: true, materialId,
});
const line = (entityId: number, x0: number, y0: number, x1: number, y1: number): DrawingLine => ({
  line: { start: { x: x0, y: y0 }, end: { x: x1, y: y1 } }, category: 'cut', visibility: 'visible', entityId, ifcType: 'IfcWall', modelIndex: 0, depth: 0,
} as DrawingLine);

function scene() {
  const cutPolygons = [band(1, 10, 0, 4, 0, 0.2), band(1, 12, 0, 4, 0.2, 0.3), band(2, 10, 4, 8, 0, 0.2), band(2, 12, 4, 8, 0.2, 0.3)];
  const lines = [
    line(1, 0, 0, 4, 0), line(1, 0, 0.3, 4, 0.3), line(1, 0, 0.2, 4, 0.2), line(1, 4, 0, 4, 0.3), line(1, 0, 0, 0, 0.3),
    line(2, 4, 0, 8, 0), line(2, 4, 0.3, 8, 0.3), line(2, 4, 0.2, 8, 0.2), line(2, 4, 0, 4, 0.3), line(2, 8, 0, 8, 0.3),
  ];
  const layers: LayerRef[] = [{ materialId: 10, name: NAMES[10], thickness: 0.2 }, { materialId: 11, name: NAMES[11], thickness: 0.0002 }, { materialId: 12, name: NAMES[12], thickness: 0.1 }];
  const resolver: MaterialResolver = {
    graphics: (p) => (p.materialId !== undefined && NAMES[p.materialId] ? materialGraphics(NAMES[p.materialId], []) : null),
    layers: () => layers,
    membrane: (l) => l.thickness < 0.002 || !!materialGraphics(l.name, []).membrane,
  };
  return { drawing: { cutPolygons, lines } as unknown as Drawing2D, resolver };
}

describe('building materials in a cut', () => {
  it('guesses hatches and membranes from material names', () => {
    assert.equal(guessMaterial('Concrete C25/30').hatch, 'CONCRETE');
    assert.equal(guessMaterial('Mineral wool').hatch, 'INSULATION');
    assert.equal(guessMaterial('Cărămidă plină'.normalize('NFD').replace(/[̀-ͯ]/g, '')).hatch, 'BRICK');
    assert.equal(guessMaterial('Vapour barrier').membrane, true);
    assert.equal(guessMaterial('Something else').hatch, null);
  });

  it('hatches each band, drops the lines inside one material, and draws the foil as a membrane', () => {
    const { drawing, resolver } = scene();
    const m = materialDrawing(drawing, resolver);
    assert.deepEqual(m.hatches.map((h) => h.pattern).sort(), ['CONCRETE', 'CONCRETE', 'INSULATION', 'INSULATION']);
    // Both walls' x = 4 lines lie where concrete meets concrete and wool meets wool: gone. The outer x = 0 / 8 stay.
    const dropped = [...m.dropLines].map((l) => `${l.entityId}:${l.line.start.x},${l.line.start.y}-${l.line.end.x},${l.line.end.y}`).sort();
    assert.ok(dropped.includes('1:4,0-4,0.3') && dropped.includes('2:4,0-4,0.3'));
    assert.ok(!dropped.some((d) => d.includes('0,0-0,0.3') || d.includes('8,0-8,0.3')));
    // The interface y = 0.2 is the foil: a membrane line per wall, and the plain line there goes.
    assert.equal(m.membranes.length, 2);
    assert.ok(m.membranes.every((s) => s.type === 'line' && Math.abs(s.a.y - 0.2) < 1e-9 && Math.abs(s.b.y - 0.2) < 1e-9));
    assert.ok(dropped.includes('1:0,0.2-4,0.2') && dropped.includes('2:4,0.2-8,0.2'));
    // Mineral wool has no fill by default: white behind the hatch.
    assert.equal([...m.fills.values()].filter((f) => f === null).length, 2);
  });

  it('a membrane thick enough for its own band is drawn as its middle line, the band left out', () => {
    const { drawing, resolver } = scene();
    drawing.cutPolygons.push(band(3, 13, 0, 6, 1, 1.004));
    const m = materialDrawing(drawing, resolver);
    assert.ok(m.hidePolygons.has(drawing.cutPolygons[4]));
    assert.ok(m.membranes.some((s) => s.type === 'line' && Math.abs(s.a.y - 1.002) < 1e-9 && Math.abs(Math.abs(s.b.x - s.a.x) - 6) < 1e-9));
  });

  it('flows through the view styling: dropped lines go, material hatches join the cut hatches unless the category overrides', () => {
    const { drawing, resolver } = scene();
    const styled = styledDrawing(drawing, undefined, () => null, undefined, materialDrawing(drawing, resolver));
    assert.equal(styled.lines.length, drawing.lines.length - 4);
    assert.equal(styled.membranes?.length, 2);
    assert.equal(cutHatches(styled, undefined).length, 4);
    assert.equal(cutHatches(styled, { categories: { walls: { cutHatch: 'CROSS' } } }).filter((h) => h.pattern === 'CROSS').length, 4);
    assert.equal(cutHatches(styled, { categories: { walls: { cutHatch: 'CROSS' } } }).length, 4);
  });

  it('segments coincide when collinear and mostly overlapping', () => {
    assert.ok(coincide({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { a: { x: 2, y: 0.001 }, b: { x: 0.2, y: 0 } }));
    assert.ok(!coincide({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { a: { x: 0, y: 0.01 }, b: { x: 2, y: 0.01 } }));
    assert.ok(!coincide({ a: { x: 0, y: 0 }, b: { x: 2, y: 0 } }, { a: { x: 1.9, y: 0 }, b: { x: 3, y: 0 } }));
  });
});
