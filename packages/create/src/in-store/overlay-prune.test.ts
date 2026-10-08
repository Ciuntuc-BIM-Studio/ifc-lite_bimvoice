/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Regenerating an element in place leaves no orphan records behind: the
 * overlay stays the same size however often the geometry is rewritten,
 * styled items go with their geometry, and records still in use survive.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addExtrusionToStore, replaceExtrusionGeometryInStore } from './extrusion.js';
import { addFacetedElementToStore, replaceFacetedGeometryInStore } from './faceted.js';
import { elementGeometryRefs, pruneOrphanOverlay } from './overlay-prune.js';
import { defaultRoofStructure } from './roof-structure.js';
import { addRoofSystemToStore, regenerateRoofSystemInStore, removeRoofSystemFromStore, type RoofSystemSpec } from './roof-system-store.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function session() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  return { store, view, editor: new StoreEditor(store, view), anchor: resolveSpatialAnchor(store, 42, view) };
}

const square = (s: number, o = 0): [number, number][] => [[o, o], [o + s, o], [o + s, o + s], [o, o + s]];

type V3 = [number, number, number];
function box(s: number): V3[][] {
  const p = (x: number, y: number, z: number): V3 => [x * s, y * s, z * s];
  return [
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)], [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)], [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)],
    [p(1, 1, 0), p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)], [p(0, 1, 0), p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
  ];
}

describe('pruneOrphanOverlay', () => {
  it('keeps the overlay the same size across repeated extrusion rewrites', async () => {
    const { view, editor, anchor } = await session();
    const made = addExtrusionToStore(editor, anchor, { IfcClass: 'IfcSlab', Outer: square(2), Depth: 0.2, Location: [0, 0, 0] });
    replaceExtrusionGeometryInStore(editor, anchor, made.elementId, { IfcClass: 'IfcSlab', Outer: square(3), Depth: 0.2, Location: [0, 0, 0] });
    const size = view.getNewEntities().length;
    for (let i = 0; i < 5; i++) {
      replaceExtrusionGeometryInStore(editor, anchor, made.elementId, { IfcClass: 'IfcSlab', Outer: square(4 + i), Depth: 0.3, Location: [i, 0, 0] });
    }
    expect(view.getNewEntities().length).toBe(size);
    expect(view.getNewEntity(made.placementId)).toBeNull();
    expect(view.getNewEntity(made.productShapeId)).toBeNull();
    // The element, its containment and the storey's placement chain are untouched.
    expect(view.getNewEntity(made.elementId)).not.toBeNull();
    expect(view.getNewEntity(made.relContainedId)).not.toBeNull();
  });

  it('drops the styled items of a faceted body with it, and keeps a shared style', async () => {
    const { view, editor, anchor } = await session();
    const made = addFacetedElementToStore(editor, anchor, { IfcClass: 'IfcRoof', Faces: box(1), Location: [0, 0, 0] });
    const style = editor.addEntity('IfcSurfaceStyle', ['Red', '.BOTH.', []]).expressId;
    const brep = view.getNewEntities().find((e) => e.type === 'IfcFacetedBrep')!.expressId;
    const styled = editor.addEntity('IfcStyledItem', [`#${brep}`, [`#${style}`], null]).expressId;
    // A second element sharing the style keeps it alive.
    const other = addFacetedElementToStore(editor, anchor, { IfcClass: 'IfcRoof', Faces: box(2), Location: [5, 0, 0] });
    const otherBrep = view.getNewEntities().filter((e) => e.type === 'IfcFacetedBrep').at(-1)!.expressId;
    editor.addEntity('IfcStyledItem', [`#${otherBrep}`, [`#${style}`], null]);
    replaceFacetedGeometryInStore(editor, anchor, made.elementId, { IfcClass: 'IfcRoof', Faces: box(3), Location: [0, 0, 0] });
    expect(view.getNewEntity(brep)).toBeNull();
    expect(view.getNewEntity(styled)).toBeNull();
    expect(view.getNewEntity(style)).not.toBeNull();
    expect(view.getNewEntity(other.elementId)).not.toBeNull();
    expect(view.getNewEntity(otherBrep)).not.toBeNull();
  });

  it('keeps a representation another element still shares', async () => {
    const { view, editor, anchor } = await session();
    const made = addExtrusionToStore(editor, anchor, { IfcClass: 'IfcColumn', Outer: square(0.3), Depth: 3, Location: [0, 0, 0] });
    // A copy pointing at the same body (as a duplicate does).
    const copy = editor.addEntity('IfcColumn', ['0abcdefghijklmnopqrstu', null, 'Copy', null, null, `#${made.placementId}`, `#${made.productShapeId}`, null, null]).expressId;
    const roots = elementGeometryRefs(editor, made.elementId);
    editor.removeEntity(made.elementId);
    expect(pruneOrphanOverlay(editor, roots)).toEqual([]);
    expect(view.getNewEntity(made.productShapeId)).not.toBeNull();
    editor.removeEntity(copy);
    expect(pruneOrphanOverlay(editor, roots).length).toBeGreaterThan(3);
    expect(view.getNewEntity(made.productShapeId)).toBeNull();
    expect(view.getNewEntity(made.placementId)).toBeNull();
  });

  it('keeps a regenerated roof system the same size, and leaves nothing of a deleted one', async () => {
    const { store, view, editor, anchor } = await session();
    const before = view.getNewEntities().length;
    const spec = (pitch: number): RoofSystemSpec => ({
      name: 'Roof', outline: [[0, 0], [10, 0], [10, 6], [0, 6]], eaveHeight: 3,
      rules: [{ kind: 'eave', pitch, overhang: 0.5 }, { kind: 'eave', pitch, overhang: 0.5 }, { kind: 'eave', pitch, overhang: 0.5 }, { kind: 'eave', pitch, overhang: 0.5 }],
      covering: { thickness: 0.08, color: '#a0522d' }, structure: defaultRoofStructure(), timberColor: '#c8a070',
    });
    const made = addRoofSystemToStore(editor, anchor, spec(35));
    regenerateRoofSystemInStore(store, editor, anchor, made.roofId, spec(30));
    const size = view.getNewEntities().length;
    for (const pitch of [32, 40, 30]) regenerateRoofSystemInStore(store, editor, anchor, made.roofId, spec(pitch));
    expect(view.getNewEntities().length).toBe(size);
    removeRoofSystemFromStore(store, editor, made.roofId);
    expect(view.getNewEntities().length).toBe(before);
  });
});
