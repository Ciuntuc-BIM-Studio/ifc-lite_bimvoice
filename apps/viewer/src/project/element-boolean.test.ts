/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Studio's boolean operations on the selection: the element selected first is
 * the target; Subtract is live and taken back by Remove operation; Union is
 * live too: the tool stays, hidden as part of the target, shown by Show
 * operands, set free by Remove operation; one Undo takes the union back.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addWallToStore, readCombinations, readSubtractions, resolveSpatialAnchor } from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { MODEL_ID, STOREY, seedModelingSession } from '@/test/modeling-session-fixture';
import { bakeSelection, booleanSelection, removeSubtractionsOfSelection, subtractSelection, toggleOperandsOfSelection } from './element-boolean';

const live = () => {
  const s = useViewerStore.getState();
  return { dataStore: s.models.get(MODEL_ID)!.ifcDataStore!, view: s.mutationViews.get(MODEL_ID)! };
};
const exists = (id: number) => { const { view } = live(); return !!view.getNewEntity(id) && !view.isDeleted(id); };
const gid = (id: number) => toGlobalIdFromModels(useViewerStore.getState().models, MODEL_ID, id);

function crossing(): { a: number; b: number } {
  return recordModellingCommit(useViewerStore, MODEL_ID, (editor, ds) => {
    const anchor = resolveSpatialAnchor(ds, STOREY, editor.getMutationView());
    return {
      a: addWallToStore(editor, anchor, { Start: [0, 0, 0], End: [4, 0, 0], Thickness: 0.2, Height: 3 }).wallId,
      b: addWallToStore(editor, anchor, { Start: [2, -1, 0], End: [2, 1, 0], Thickness: 0.4, Height: 5 }).wallId,
    };
  });
}

/** Select `first`, then Shift-add `rest` (the set keeps the order). */
function select(first: number, ...rest: number[]): void {
  const s = useViewerStore.getState();
  s.setSelectedEntityIds([first, ...rest].map(gid));
  s.setSelectedEntityId(gid(first));
}

beforeEach(async () => {
  await seedModelingSession();
  useViewerStore.setState({ editEnabled: true });
});

describe('Studio boolean operations', () => {
  it('the first selected is the target; one element alone is not enough', () => {
    const { a, b } = crossing();
    select(b, a);
    assert.deepEqual(booleanSelection(), { ok: true, modelId: MODEL_ID, target: b, tools: [a] });
    select(a);
    assert.deepEqual(booleanSelection(), { ok: false, error: 'select' });
  });

  it('subtracts live, and Remove subtraction takes it back', () => {
    const { a, b } = crossing();
    select(a, b);
    assert.equal(subtractSelection().ok, true);
    assert.deepEqual(readSubtractions(live().dataStore, live().view).map((s) => [s.target, s.tool]), [[a, b]]);
    assert.ok(exists(a) && exists(b), 'both stay');
    select(b);
    assert.equal(removeSubtractionsOfSelection(), 2);
    assert.equal(readSubtractions(live().dataStore, live().view).length, 0);
  });

  it('unites live: the tool stays, hidden; Show operands shows it, Remove operation sets it free, Undo takes the union back', () => {
    const { a, b } = crossing();
    select(a, b);
    assert.deepEqual(bakeSelection('UNION').error, null);
    assert.ok(exists(a) && exists(b), 'the tool stays an element');
    assert.deepEqual(readCombinations(live().dataStore, live().view).map((c) => [c.target, c.tool, c.op]), [[a, b, 'UNION']]);
    const hidden = () => useViewerStore.getState().hiddenEntities.has(gid(b));
    assert.equal(hidden(), true, 'drawn as part of the target');
    assert.equal(useViewerStore.getState().selectedEntityId, gid(a));
    select(a);
    assert.equal(toggleOperandsOfSelection(), 1);
    assert.equal(hidden(), false, 'shown for editing');
    toggleOperandsOfSelection();
    assert.equal(hidden(), true);
    assert.equal(removeSubtractionsOfSelection(), 2);
    assert.equal(readCombinations(live().dataStore, live().view).length, 0);
    assert.equal(hidden(), false, 'set free, drawn again');
    useViewerStore.getState().undo(MODEL_ID);
    assert.equal(readCombinations(live().dataStore, live().view).length, 1, 'undo brings the union back');
    useViewerStore.getState().undo(MODEL_ID);
    assert.equal(readCombinations(live().dataStore, live().view).length, 0, 'and the next takes it away');
    assert.ok(exists(b));
  });
});
