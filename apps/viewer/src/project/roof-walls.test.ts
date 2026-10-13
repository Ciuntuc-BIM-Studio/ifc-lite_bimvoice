/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Walls under roofs in the viewer: a roof system's gable walls are made,
 * moved and removed with it (Apply, Delete roof); a wall attached with
 * "Attach to roof" finds the roof over it and is detached when the roof goes.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addRoofSystemToStore, addWallToStore, defaultRoofStructure, readWallMetres, readWallRoofTrim, resolveSpatialAnchor, roofTrimmedWalls, type RoofSystemSpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { MODEL_ID, STOREY, seedModelingSession } from '@/test/modeling-session-fixture';
import { applyRoofSystem, deleteRoofSystem } from './roof-system-element';
import { attachSelectedWallsToRoof } from './roof-walls';

const spec: RoofSystemSpec = {
  name: 'Roof', outline: [[0, 0], [10, 0], [10, 6], [0, 6]], eaveHeight: 3,
  rules: [{ kind: 'eave', pitch: 30, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }, { kind: 'eave', pitch: 30, overhang: 0.5 }, { kind: 'gable', pitch: 0, overhang: 0.3 }],
  covering: { thickness: 0.08, color: '#a0522d' }, structure: { ...defaultRoofStructure(), system: 'none' }, timberColor: '#c8a070',
};

const live = () => {
  const s = useViewerStore.getState();
  const editor = s.storeEditors.get(MODEL_ID)!;
  return { dataStore: s.models.get(MODEL_ID)!.ifcDataStore!, view: s.mutationViews.get(MODEL_ID)!, editor };
};
const exists = (id: number) => { const { view } = live(); return !!view.getNewEntity(id) && !view.isDeleted(id); };

function addRoof(): { roofId: number; globalId: string } {
  return recordModellingCommit(useViewerStore, MODEL_ID, (editor, ds) => addRoofSystemToStore(editor, resolveSpatialAnchor(ds, STOREY, editor.getMutationView()), spec));
}

beforeEach(async () => {
  await seedModelingSession();
  useViewerStore.setState({ editEnabled: true });
});

describe('gable walls of a roof system', () => {
  it('Apply makes one wall per gable, inside the outline and cut by the roof; turned off they go; Delete roof takes them', () => {
    const roof = addRoof();
    const ref = { modelId: MODEL_ID, roofId: roof.roofId };
    const gableWalls = { enabled: true, thickness: 0.3, offset: 0.1, flip: false, top: 'covering' as const };
    assert.deepEqual(applyRoofSystem(ref, { ...spec, gableWalls }), { ok: true });

    let walls = roofTrimmedWalls(live().dataStore, live().view, roof.globalId);
    assert.deepEqual(walls.map((w) => w.trim.gable).sort(), [1, 3]);
    const east = walls.find((w) => w.trim.gable === 1)!;
    const m = readWallMetres(live(), east.wallId)!;
    assert.deepEqual(m.start.map((v) => +v.toFixed(6)), [9.75, 0, 3]);
    assert.ok(Math.abs(m.thickness - 0.3) < 1e-9);

    // Applied again (another pitch): the same walls, moved with the roof.
    assert.deepEqual(applyRoofSystem(ref, { ...spec, rules: spec.rules.map((r) => (r.kind === 'eave' ? { ...r, pitch: 40 } : r)), gableWalls }), { ok: true });
    walls = roofTrimmedWalls(live().dataStore, live().view, roof.globalId);
    assert.ok(walls.some((w) => w.wallId === east.wallId), 'the east gable wall is kept');

    // Off: they leave.
    assert.deepEqual(applyRoofSystem(ref, { ...spec, gableWalls: { ...gableWalls, enabled: false } }), { ok: true });
    assert.equal(roofTrimmedWalls(live().dataStore, live().view, roof.globalId).length, 0);
    assert.equal(exists(east.wallId), false);

    // On again, then the roof is deleted: its gable walls go with it.
    applyRoofSystem(ref, { ...spec, gableWalls });
    const again = roofTrimmedWalls(live().dataStore, live().view, roof.globalId).map((w) => w.wallId);
    assert.equal(again.length, 2);
    assert.deepEqual(deleteRoofSystem(ref), { ok: true });
    assert.ok(again.every((id) => !exists(id)));
  });
});

describe('Attach to roof', () => {
  it('finds the roof over the wall, and the wall is detached (kept) when the roof is deleted', () => {
    const roof = addRoof();
    const wall = recordModellingCommit(useViewerStore, MODEL_ID, (editor, ds) =>
      addWallToStore(editor, resolveSpatialAnchor(ds, STOREY, editor.getMutationView()), { Start: [5, 0, 0], End: [5, 6, 0], Thickness: 0.2, Height: 2.5 })).wallId;
    useViewerStore.getState().setSelectedEntityId(toGlobalIdFromModels(useViewerStore.getState().models, MODEL_ID, wall));
    assert.deepEqual(attachSelectedWallsToRoof('covering'), { attached: 1, noRoof: 0 });
    assert.deepEqual(readWallRoofTrim(live().dataStore, wall, live().view), { roof: roof.globalId, top: 'covering' });

    assert.deepEqual(deleteRoofSystem({ modelId: MODEL_ID, roofId: roof.roofId }), { ok: true });
    assert.equal(exists(wall), true, 'an attached wall stays');
    assert.equal(readWallRoofTrim(live().dataStore, wall, live().view), null);
  });
});
