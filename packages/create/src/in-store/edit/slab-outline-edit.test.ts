/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { addSlabToStore } from '../slab.js';
import { resolveSpatialAnchor } from '../resolve-anchor.js';
import { resolveSlabEditChain } from './slab-edit.js';
import { setSlabOutlineInStore, slabOutlineProblem } from './slab-outline-edit.js';

async function model() {
  const bytes = readFileSync(new URL('../../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const storey = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
  return { store, view, editor, anchor: resolveSpatialAnchor(store, storey, view) };
}

describe('setSlabOutlineInStore', () => {
  it('reshapes a placed slab to a new outline, keeping its height and thickness', async () => {
    const { store, view, editor, anchor } = await model();
    const slab = addSlabToStore(editor, anchor, { Position: [2, 1, 0.5], Width: 4, Depth: 3, Thickness: 0.2 }).slabId;
    const before = resolveSlabEditChain(store, view, editor, slab)!;
    const outline: [number, number][] = [[2, 1], [7, 1], [7, 3], [4, 3], [4, 5], [2, 5]];
    const outcome = setSlabOutlineInStore({ dataStore: store, view, editor }, slab, outline);
    expect(outcome).toEqual({ ok: true, remesh: [slab] });
    const after = resolveSlabEditChain(store, view, editor, slab)!;
    expect(after.profileKind).toBe('polygon');
    expect(after.footprint.map((p) => p.map((v) => +v.toFixed(6)))).toEqual(outline);
    expect(after.thickness).toBeCloseTo(before.thickness, 9);
    expect(after.baseElevation).toBeCloseTo(before.baseElevation!, 9);
  });

  it('refuses an outline that crosses itself or has no area', async () => {
    expect(slabOutlineProblem([[0, 0], [2, 2], [2, 0], [0, 2]])).toMatch(/crosses itself/);
    expect(slabOutlineProblem([[0, 0], [1, 0], [2, 0]])).toMatch(/no area/);
    const { store, view, editor, anchor } = await model();
    const slab = addSlabToStore(editor, anchor, { Position: [0, 0, 0], Width: 2, Depth: 2, Thickness: 0.2 }).slabId;
    expect(setSlabOutlineInStore({ dataStore: store, view, editor }, slab, [[0, 0], [1, 1]]).ok).toBe(false);
  });
});
