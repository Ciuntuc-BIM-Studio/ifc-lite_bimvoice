/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** N7: an imported model's untyped doors and windows take Lapin joinery types of their size and lift as native. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { addHostedElementInStore } from '../in-store/hosted-element.js';
import { addWallToStore } from '../in-store/wall.js';
import { resolveSpatialAnchor } from '../in-store/resolve-anchor.js';
import { liftNativeModel } from './lift.js';
import { convertToNativeInStore, planNativeConversion } from './convert.js';


describe('convert to native (N7)', () => {
  it('groups untyped joinery by class and size, converts it, and the lift then reads it as native', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const storey = [...(store.spatialHierarchy?.storeyElevations.keys() ?? [])][0];
    const WALL = addWallToStore(editor, resolveSpatialAnchor(store, storey, view), { Start: [0, 20, 0], End: [14, 20, 0], Thickness: 0.3, Height: 2.7 }).wallId;
    const w1 = addHostedElementInStore(store, editor, WALL, { kind: 'window', params: { Offset: 2, Sill: 0.9, Width: 1.2, Height: 1.5 } }).expressId;
    const w2 = addHostedElementInStore(store, editor, WALL, { kind: 'window', params: { Offset: 5, Sill: 0.9, Width: 1.2, Height: 1.5 } }).expressId;
    const d1 = addHostedElementInStore(store, editor, WALL, { kind: 'door', params: { Offset: 9, Width: 0.9, Height: 2.1 } }).expressId;

    const plan = planNativeConversion(store, view);
    const byName = new Map(plan.joinery.map((g) => [g.spec.name, g]));
    expect([...byName.keys()].sort()).toEqual(['Door 900×2100', 'Window 1200×1500']);
    expect(byName.get('Window 1200×1500')!.ids.sort()).toEqual([w1, w2].sort());
    expect(byName.get('Window 1200×1500')!.spec.sillHeight).toBeCloseTo(0.9, 6);
    expect(byName.get('Door 900×2100')!.ids).toEqual([d1]);

    const result = editor.runAtomic((draft) => convertToNativeInStore(store, draft, plan));
    expect(result.refused).toEqual([]);
    expect(result.converted).toBe(3);
    const after = liftNativeModel(store, view, { id: '00000000-0000-4000-8000-000000000001', name: '' });
    const joinery = after.model.elements.filter((e) => e.kind === 'door' || e.kind === 'window');
    expect(joinery.length).toBe(3);
    expect(after.skipped.filter((s) => s.reason === 'no configured joinery type')).toEqual([]);
    // Nothing left to convert: a second plan finds no joinery to type.
    expect(planNativeConversion(store, view).joinery).toEqual([]);
  });
});
