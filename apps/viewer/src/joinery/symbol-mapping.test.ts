/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Symbol mapping: manual choices first (element, then IFC type), then by
 * name, then by dimensions; entries fitted to the element; files read back
 * leniently. And the elevation placement of a typed or mapped window.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultDoorSpec, defaultWindowSpec, type JoinerySpec } from '@ifc-lite/create';
import { DEFAULT_JOINERY_MAPPING, fitToElement, normaliseName, readJoineryMapping, resolveMapping, type ElementFacts, type JoineryMapping } from './symbol-mapping';
import { typedElevationSymbol } from './elevation-placement';

const w1: JoinerySpec = { ...defaultWindowSpec('Casement 1200'), id: 'w1', mark: 'W1', width: 1.2, height: 1.5 };
const w2: JoinerySpec = { ...defaultWindowSpec('Fixed 600'), id: 'w2', mark: 'W2', width: 0.6, height: 1.5 };
const d1: JoinerySpec = { ...defaultDoorSpec('Single 900'), id: 'd1', mark: 'D1', width: 0.9, height: 2.1 };
const list = [w1, w2, d1];
const facts = (over: Partial<ElementFacts> = {}): ElementFacts => ({
  kind: 'window', globalId: 'g-el', typeGlobalId: 'g-type', names: ['Window type A'], width: 1.21, height: 1.49, ...over,
});
const mapping = (over: Partial<JoineryMapping> = {}): JoineryMapping => ({ ...DEFAULT_JOINERY_MAPPING, ...over });

describe('resolveMapping', () => {
  it('matches by dimensions within the tolerance, the closest entry of the kind', () => {
    assert.deepEqual(resolveMapping(mapping(), list, facts()), { entry: w1, source: 'dimensions' });
    assert.equal(resolveMapping(mapping({ tolerance: 0.005 }), list, facts()), null);
    assert.equal(resolveMapping(mapping({ byDimensions: false }), list, facts()), null);
    // A door of a window's size is not a window.
    assert.equal(resolveMapping(mapping(), list, facts({ kind: 'door' })), null);
  });

  it('matches by name, mark or alias before dimensions, ignoring case and punctuation', () => {
    assert.equal(resolveMapping(mapping(), list, facts({ names: ['fixed-600'] }))?.entry, w2);
    assert.equal(resolveMapping(mapping(), list, facts({ names: ['w 2'] }))?.entry, w2);
    const aliased = resolveMapping(mapping({ aliases: { w2: ['M_Fixed:0610 x 1520mm'] } }), list, facts({ names: ['m_fixed 0610x1520 mm'] }));
    assert.deepEqual(aliased, { entry: w2, source: 'name' });
    assert.equal(resolveMapping(mapping({ byName: false }), list, facts({ names: ['W2'] }))?.entry, w1);
  });

  it('a manual choice wins: the element\'s over its type\'s over the rules; null means none', () => {
    assert.deepEqual(resolveMapping(mapping({ types: { 'g-type': 'w2' } }), list, facts()), { entry: w2, source: 'type' });
    assert.deepEqual(resolveMapping(mapping({ types: { 'g-type': 'w2' }, elements: { 'g-el': 'w1' } }), list, facts()), { entry: w1, source: 'element' });
    assert.equal(resolveMapping(mapping({ elements: { 'g-el': null } }), list, facts()), null);
    assert.equal(resolveMapping(mapping({ types: { 'g-type': null } }), list, facts()), null);
    // A choice whose entry is gone (or of the other kind) falls back to the rules.
    assert.equal(resolveMapping(mapping({ elements: { 'g-el': 'gone' } }), list, facts())?.source, 'dimensions');
    assert.equal(resolveMapping(mapping({ elements: { 'g-el': 'd1' } }), list, facts())?.source, 'dimensions');
  });

  it('fits the entry to the element (panels are proportions)', () => {
    const fitted = fitToElement(w1, { width: 1.21, height: 1.49 });
    assert.equal(fitted.width, 1.21);
    assert.equal(fitted.height, 1.49);
    assert.deepEqual(fitted.columns, w1.columns);
    assert.equal(fitToElement(w1, { width: null, height: null }), w1);
  });

  it('normalises names and reads a mapping back leniently', () => {
    assert.equal(normaliseName(' D-01 / Ușă '), 'd01ușă');
    assert.deepEqual(readJoineryMapping(undefined), DEFAULT_JOINERY_MAPPING);
    assert.deepEqual(
      readJoineryMapping({ byName: false, tolerance: -1, aliases: { w1: ['A', 3, ' '] }, types: { t: 'w1', u: 4 }, elements: { e: null } }),
      { byName: false, byDimensions: true, tolerance: DEFAULT_JOINERY_MAPPING.tolerance, aliases: { w1: ['A'] }, types: { t: 'w1' }, elements: { e: null } },
    );
  });
});

describe('typedElevationSymbol', () => {
  // A window 1.2 × 1.5 at x 0…1.2, sill 0.9, in a wall along x; identity placement: IFC local Y (exterior) is world −z.
  const world = [0, 0.9, 0, 1.2, 0.9, 0, 1.2, 2.4, 0, 0, 2.4, 0, 0, 0.9, -0.1, 1.2, 2.4, -0.1];
  const l2w = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const xs = (s: { thin: { type: string; pts?: { x: number; y: number }[] }[] }) => s.thin.flatMap((d) => d.pts ?? []);

  it('puts the frame on the element, seen from the interior from +z', () => {
    const placed = typedElevationSymbol(w1, world, l2w, { axis: 'z', position: 5, flipped: false });
    assert.ok(placed);
    const pts = xs(placed);
    assert.ok(Math.abs(Math.min(...pts.map((p) => p.x)) - 0) < 1e-9 && Math.abs(Math.max(...pts.map((p) => p.x)) - 1.2) < 1e-9);
    assert.ok(Math.abs(Math.min(...pts.map((p) => p.y)) - 0.9) < 1e-9 && Math.abs(Math.max(...pts.map((p) => p.y)) - 2.4) < 1e-9);
    // Interior: the sashes open towards the viewer, marks solid.
    assert.equal(placed.dashed.length, 0);
  });

  it('seen from the exterior the marks are dashed; seen edge-on there is no symbol', () => {
    const outside = typedElevationSymbol(w1, world, l2w, { axis: 'z', position: -5, flipped: true });
    assert.ok(outside && outside.dashed.length > 0);
    assert.equal(typedElevationSymbol(w1, world, l2w, { axis: 'x', position: 5, flipped: false }), null);
    assert.equal(typedElevationSymbol(w1, world, l2w, { axis: 'y', position: 1, flipped: false }), null);
  });
});
