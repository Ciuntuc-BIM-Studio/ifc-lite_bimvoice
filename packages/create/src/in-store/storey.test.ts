/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Adding a storey to a loaded model: framed like the reference storey,
 * raised by the elevation difference, aggregated into the building, and
 * usable as an authoring anchor straight away.
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addStoreyToStore } from './storey.js';
import { addWallToStore } from './wall.js';
import { effectiveStoreyIds, createOverlayLookup } from './spatial-children.js';

// Bonsai/IfcOpenShell IFC4 sample, with one parsed storey (#42).
const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function session() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    { disableWorkerScan: true },
  );
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  return { store, view, editor };
}

describe('addStoreyToStore', () => {
  it('writes a storey at the elevation, framed like the reference, aggregated into the building', async () => {
    const { store, view, editor } = await session();
    const reference = resolveSpatialAnchor(store, 42, view);
    const made = addStoreyToStore(store, editor, reference, { Name: 'Level 1', Elevation: 3.2 });

    const storey = view.getNewEntity(made.storeyId);
    expect(storey?.type.toUpperCase()).toBe('IFCBUILDINGSTOREY');
    expect(storey?.attributes[0]).toBe(made.globalId);
    expect(storey?.attributes[2]).toBe('Level 1');
    expect(storey?.attributes[5]).toBe(`#${made.placementId}`);
    expect(storey?.attributes[9]).toBeCloseTo(3.2);

    const rel = view.getNewEntity(made.relAggregatesId);
    expect(rel?.attributes[4]).toBe(`#${made.buildingId}`);
    expect(rel?.attributes[5]).toEqual([`#${made.storeyId}`]);

    const lookup = createOverlayLookup(view);
    expect(effectiveStoreyIds(store, lookup)).toContain(made.storeyId);
  });

  it('is a valid authoring anchor: a wall can be placed on the new storey', async () => {
    const { store, view, editor } = await session();
    const made = addStoreyToStore(store, editor, resolveSpatialAnchor(store, 42, view), { Name: 'Level 1', Elevation: 3 });
    const anchor = resolveSpatialAnchor(store, made.storeyId, view);
    expect(anchor.storeyPlacementId).toBe(made.placementId);
    const wall = addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [4, 0, 0], Thickness: 0.2, Height: 3 });
    expect(wall.wallId).toBeGreaterThan(0);
  });

  it('keeps an explicit GlobalId and refuses an invalid one or an empty name', async () => {
    const { store, view, editor } = await session();
    const reference = resolveSpatialAnchor(store, 42, view);
    const made = addStoreyToStore(store, editor, reference, { Name: 'Roof', Elevation: 9, GlobalId: '0Storey000000000000009' });
    expect(made.globalId).toBe('0Storey000000000000009');
    expect(() => addStoreyToStore(store, editor, reference, { Name: 'X', Elevation: 1, GlobalId: 'nope' })).toThrow(/GlobalId/);
    expect(() => addStoreyToStore(store, editor, reference, { Name: '  ', Elevation: 1 })).toThrow(/name/);
  });
});
