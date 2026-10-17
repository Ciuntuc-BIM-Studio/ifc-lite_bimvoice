/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { addWallToStore } from './wall.js';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { PresentationLayerIndex } from './presentation-layers.js';
import { refId } from './host-geometry-frame.js';
import { AnchorEntityReader } from './resolve-anchor.js';

describe('IFC presentation layers', () => {
  it('puts an element on the layers of its representations and of their items', async () => {
    const bytes = readFileSync(new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url));
    const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
    const view = new MutablePropertyView(null, 'm');
    const editor = new StoreEditor(store, view);
    const anchor = resolveSpatialAnchor(store, [...store.spatialHierarchy!.storeyElevations.keys()][0], view);
    const a = addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [4, 0, 0], Thickness: 0.2, Height: 3 }).wallId;
    const b = addWallToStore(editor, anchor, { Start: [0, 5, 0], End: [4, 5, 0], Thickness: 0.2, Height: 3 }).wallId;
    const c = addWallToStore(editor, anchor, { Start: [0, 9, 0], End: [4, 9, 0], Thickness: 0.2, Height: 3 }).wallId;
    const r = new AnchorEntityReader(store, view);
    const reps = (id: number) => (r.entity(refId(r.entity(id)!.attributes[6])!)!.attributes[2] as unknown[]).map((x) => refId(x)!);
    // A's Body representation on A-WALL; B's first body item on S-STRUCT (and its representation on A-WALL too).
    const bodyItem = (r.entity(reps(b)[0])!.attributes[3] as unknown[]).map((x) => refId(x)!)[0];
    editor.addEntity('IfcPresentationLayerAssignment', ['A-WALL', null, [`#${reps(a)[0]}`, `#${reps(b)[0]}`], null]);
    editor.addEntity('IfcPresentationLayerAssignment', ['S-STRUCT', null, [`#${bodyItem}`], null]);

    const index = new PresentationLayerIndex(store, view);
    expect(index.names).toEqual(['A-WALL', 'S-STRUCT']);
    expect(index.of(a)).toEqual(['A-WALL']);
    expect([...index.of(b)].sort()).toEqual(['A-WALL', 'S-STRUCT']);
    expect(index.of(c)).toEqual([]);
  });
});
