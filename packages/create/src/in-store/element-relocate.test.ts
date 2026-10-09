/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addStoreyToStore } from './storey.js';
import { addWallToStore } from './wall.js';
import { effectiveStoreyId } from './edit/effective-storey.js';
import { objectPlacementOf, parentPlacementOf } from './element-transform-frames.js';
import { moveElementsToStoreyInStore, readElementPlacement, setElementPlacementInStore } from './element-relocate.js';
import { eulerFromRotation, rotationFromEuler, worldFrame, type Frame3D } from './placement-3d.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function scene() {
  const bytes = await readFile(SAMPLE);
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const ground = resolveSpatialAnchor(store, 42, view);
  const level1 = addStoreyToStore(store, editor, ground, { Name: 'Level 1', Elevation: 3.2 });
  const wall = addWallToStore(editor, ground, { Start: [1, 2, 0.5], End: [5, 2, 0.5], Thickness: 0.2, Height: 3 });
  const world = (id: number): Frame3D => worldFrame({ dataStore: store, view }, objectPlacementOf({ dataStore: store, view }, id)!)!;
  return { store, view, editor, level1, wall: wall.wallId, world };
}

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('rotations', () => {
  it('reads back the X, Y, Z angles it was built from', () => {
    for (const [rx, ry, rz] of [[0.3, -0.4, 1.2], [0, 0, 2.5], [-1, 0.7, 0]]) close(eulerFromRotation(rotationFromEuler(rx, ry, rz)), [rx, ry, rz]);
  });
});

describe('moving elements to another storey', () => {
  it('relative to the storey: contained in the new one, its placement on the new storey\'s, raised by the level difference', async () => {
    const { store, view, editor, level1, wall, world } = await scene();
    const before = world(wall).t;
    const done = moveElementsToStoreyInStore(store, editor, [wall], level1.storeyId);
    expect(done.moved).toEqual([wall]);
    expect(effectiveStoreyId(store, view, wall)).toBe(level1.storeyId);
    close(world(wall).t, [before[0], before[1], before[2] + 3.2]);
    // The placement now hangs from the new storey's.
    const r = { dataStore: store, view };
    expect(parentPlacementOf(r, objectPlacementOf(r, wall)!)).toBe(level1.placementId);
  });

  it('kept in place: on the new storey, where it was in space; moving to its own storey changes nothing', async () => {
    const { store, view, editor, level1, wall, world } = await scene();
    const before = world(wall);
    moveElementsToStoreyInStore(store, editor, [wall], level1.storeyId, 'world');
    expect(effectiveStoreyId(store, view, wall)).toBe(level1.storeyId);
    close(world(wall).t, before.t);
    expect(readElementPlacement(store, editor, wall)!.z).toBeCloseTo(before.t[2] - 3.2, 9);
    const again = moveElementsToStoreyInStore(store, editor, [wall], level1.storeyId);
    expect(again.moved).toEqual([wall]);
    close(world(wall).t, before.t);
  });

  it('the parts an element aggregates go with it', async () => {
    const { store, view, editor, level1, wall, world } = await scene();
    const ground = resolveSpatialAnchor(store, 42, view);
    const part = addWallToStore(editor, ground, { Start: [0, 0, 0], End: [0, 4, 0], Thickness: 0.2, Height: 3 }).wallId;
    editor.addEntity('IfcRelAggregates', ['3Agg0000000000000000001', null, null, null, `#${wall}`, [`#${part}`]]);
    const before = world(part).t;
    const done = moveElementsToStoreyInStore(store, editor, [wall], level1.storeyId);
    expect(done.moved.sort()).toEqual([wall, part].sort());
    expect(effectiveStoreyId(store, view, part)).toBe(level1.storeyId);
    close(world(part).t, [before[0], before[1], before[2] + 3.2]);
  });
});

describe('editing an element\'s placement', () => {
  it('writes offsets and X, Y, Z angles in its parent\'s frame, and reads them back', async () => {
    const { store, editor, wall, world } = await scene();
    const changed = setElementPlacementInStore(store, editor, wall, { x: 2, y: 3, z: 1.5, rx: 10, ry: -20, rz: 45 });
    expect(changed).toEqual([wall]);
    const back = readElementPlacement(store, editor, wall)!;
    close([back.x, back.y, back.z, back.rx, back.ry, back.rz], [2, 3, 1.5, 10, -20, 45]);
    // Turned about Z by 45°: its X axis now points between world X and Y.
    const r = world(wall).r;
    expect(r[2][0]).toBeCloseTo(-Math.sin(-20 * Math.PI / 180), 9);
    expect(() => setElementPlacementInStore(store, editor, wall, { x: NaN, y: 0, z: 0, rx: 0, ry: 0, rz: 0 })).toThrow(/number/);
  });

  it('carries parts placed beside the element by the same rigid change', async () => {
    const { store, view, editor, wall, world } = await scene();
    const ground = resolveSpatialAnchor(store, 42, view);
    const part = addWallToStore(editor, ground, { Start: [1, 2, 0.5], End: [1, 6, 0.5], Thickness: 0.2, Height: 3 }).wallId;
    editor.addEntity('IfcRelAggregates', ['3Agg0000000000000000002', null, null, null, `#${wall}`, [`#${part}`]]);
    const offset = (a: Frame3D, b: Frame3D) => [b.t[0] - a.t[0], b.t[1] - a.t[1], b.t[2] - a.t[2]];
    const start = readElementPlacement(store, editor, wall)!;
    const rel = offset(world(wall), world(part));
    setElementPlacementInStore(store, editor, wall, { ...start, z: start.z + 2, rz: 90 });
    // The part keeps its place relative to the whole: its offset turned by 90° about Z.
    close(offset(world(wall), world(part)), [-rel[1], rel[0], rel[2]]);
  });
});
