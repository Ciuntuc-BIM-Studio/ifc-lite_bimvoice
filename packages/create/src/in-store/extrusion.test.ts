/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Generic extrusions in a loaded model: any IfcElement class, voids in the
 * profile, an oriented placement, storey containment — and a geometry
 * replacement that keeps the element (expressId, GlobalId).
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addExtrusionToStore, replaceExtrusionGeometryInStore } from './extrusion.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function session() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view) };
}

const square = (s: number, o = 0): [number, number][] => [[o, o], [o + s, o], [o + s, o + s], [o, o + s]];

describe('addExtrusionToStore', () => {
  it('writes a proxy with a voided profile, oriented placement and containment', async () => {
    const { store, view, editor } = await session();
    const anchor = resolveSpatialAnchor(store, 42, view);
    const made = addExtrusionToStore(editor, anchor, {
      IfcClass: 'IfcBuildingElementProxy', Name: 'Plinth', Outer: square(4), Holes: [square(1, 1.5)], Depth: 0.5,
      Location: [2, 3, 0], Axis: [1, 0, 0], RefDirection: [0, 1, 0],
    });
    const element = view.getNewEntity(made.elementId);
    expect(element?.type).toBe('IfcBuildingElementProxy');
    expect(element?.attributes[0]).toBe(made.globalId);
    expect(element?.attributes[2]).toBe('Plinth');
    const kinds = view.getNewEntities().map((e) => e.type);
    expect(kinds).toContain('IfcArbitraryProfileDefWithVoids');
    expect(kinds).toContain('IfcExtrudedAreaSolid');
    expect(view.getNewEntity(made.relContainedId)?.attributes[5]).toBe('#42');
  });

  it('accepts any IfcElement class with its predefined type, and refuses non-elements', async () => {
    const { store, view, editor } = await session();
    const anchor = resolveSpatialAnchor(store, 42, view);
    const wall = addExtrusionToStore(editor, anchor, { IfcClass: 'ifcwall', PredefinedType: 'PARTITIONING', Outer: square(1), Depth: 3, Location: [0, 0, 0] });
    expect(wall.ifcClass).toBe('IfcWall');
    expect(view.getNewEntity(wall.elementId)?.attributes).toContain('.PARTITIONING.');
    expect(() => addExtrusionToStore(editor, anchor, { IfcClass: 'IfcSpace', Outer: square(1), Depth: 1, Location: [0, 0, 0] })).toThrow(/not an IfcElement/);
    expect(() => addExtrusionToStore(editor, anchor, { IfcClass: 'IfcWall', Outer: square(1), Depth: 0, Location: [0, 0, 0] })).toThrow(/Depth/);
  });
});

describe('replaceExtrusionGeometryInStore', () => {
  it('points the same element at a new placement and shape', async () => {
    const { store, view, editor } = await session();
    const anchor = resolveSpatialAnchor(store, 42, view);
    const made = addExtrusionToStore(editor, anchor, { IfcClass: 'IfcSlab', Outer: square(2), Depth: 0.2, Location: [0, 0, 0] });
    replaceExtrusionGeometryInStore(editor, anchor, made.elementId, { IfcClass: 'IfcSlab', Outer: square(5), Depth: 0.3, Location: [1, 1, 0] });
    const overrides = view.getPositionalMutationsForEntity(made.elementId);
    expect(overrides?.get(5)).not.toBe(`#${made.placementId}`);
    expect(overrides?.get(6)).not.toBe(`#${made.productShapeId}`);
    expect(view.getNewEntity(made.elementId)?.attributes[0]).toBe(made.globalId);
  });
});
