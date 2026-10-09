/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Model groups the way a user meets them: Group turns Edit mode on and makes
 * the selection one IfcGroup; a click on any member selects the whole group;
 * in the group's edit mode the rest of the model cannot be selected, a wall
 * built joins the group, Add / Remove pick members in and out; undo takes
 * the group back.
 */

import '@/test/setup-dom.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { MODEL_ID, STOREY, seedModelingSession } from '@/test/modeling-session-fixture';
import { setRequestRemesh } from '@/lib/commands/modeling/transaction';
import { selectPickedGlobalId, toggleGlobalIdInSelection } from '@/components/viewer/viewport-selection';
import {
  allGroups, finishGroupEdit, groupOfRenderId, groupSelection, installGroupBehaviour, setGroupPicking, startGroupEdit, ungroupSelection, useGroupEdit, useGroupPrefs,
} from './element-groups';

const s = () => useViewerStore.getState();
const gid = (expressId: number) => toGlobalIdFromModels(s().models, MODEL_ID, expressId);
const selected = () => new Set([...s().selectedEntityIds, ...(s().selectedEntityId === null ? [] : [s().selectedEntityId!])]);
const wall = (x: number) => {
  const made = s().addWall(MODEL_ID, STOREY, { Start: [x, 0, 0], End: [x + 4, 0, 0], Thickness: 0.2, Height: 3, Name: `W${x}` });
  assert.ok('expressId' in made, JSON.stringify(made));
  return made.expressId;
};

let a = 0, b = 0, c = 0;
let restoreRemesh: () => void;
beforeEach(async () => {
  await seedModelingSession();
  restoreRemesh = setRequestRemesh(() => {});
  installGroupBehaviour();
  useGroupPrefs.setState({ selectGroups: true });
  a = wall(0); b = wall(10); c = wall(20);
});
afterEach(() => {
  finishGroupEdit();
  s().exitModelWorkspace();
  restoreRemesh();
});

describe('model groups in the viewer', () => {
  it('Group switches Edit mode on, groups the selection, and a click on a member selects the group', () => {
    s().setEditEnabled(false);
    s().setSelectedEntityIds([gid(a), gid(b)]);
    const made = groupSelection('Pair');
    assert.ok(made.ok, JSON.stringify(made));
    assert.equal(s().editEnabled, true);
    assert.deepEqual(allGroups().map((g) => [g.name, new Set(g.members)]), [['Pair', new Set([a, b])]]);

    selectPickedGlobalId(gid(a));
    assert.deepEqual(selected(), new Set([gid(a), gid(b)]));
    assert.equal(s().selectedEntityId, gid(a), 'the clicked member stays the inspected one');

    // An element outside any group is selected alone.
    selectPickedGlobalId(gid(c));
    assert.deepEqual(selected(), new Set([gid(c)]));

    // Ctrl-click a member adds the whole group; letting one go drops the group.
    toggleGlobalIdInSelection(gid(b));
    assert.deepEqual(selected(), new Set([gid(a), gid(b), gid(c)]));
    toggleGlobalIdInSelection(gid(a));
    assert.deepEqual(selected(), new Set([gid(c)]));

    useGroupPrefs.setState({ selectGroups: false });
    selectPickedGlobalId(gid(a));
    assert.deepEqual(selected(), new Set([gid(a)]));
  });

  it('edit mode keeps the rest out of reach, takes in what is built, and Add / Remove change the members', async () => {
    s().setSelectedEntityIds([gid(a), gid(b)]);
    const made = groupSelection('Pair');
    assert.ok(made.ok && made.group);
    startGroupEdit(made.group);
    assert.deepEqual(s().ghostExceptEntities, new Set([gid(a), gid(b)]));

    selectPickedGlobalId(gid(c));
    assert.deepEqual(selected(), new Set(), 'an element outside the group cannot be selected');
    selectPickedGlobalId(gid(a));
    assert.deepEqual(selected(), new Set([gid(a)]), 'a member is selected alone');

    const built = wall(30);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(groupOfRenderId(gid(built)), 'what is built while editing joins the group');

    setGroupPicking('add');
    selectPickedGlobalId(gid(c));
    assert.equal(groupOfRenderId(gid(c))?.groupId, made.group.groupId);
    setGroupPicking('remove');
    selectPickedGlobalId(gid(a));
    assert.equal(groupOfRenderId(gid(a)), null);
    assert.deepEqual(s().ghostExceptEntities, new Set([gid(b), gid(built), gid(c)]));

    finishGroupEdit();
    assert.equal(useGroupEdit.getState().editing, null);
    assert.equal(s().ghostExceptEntities, null);
  });

  it('Ungroup dissolves the group, and undo brings it back', () => {
    s().setSelectedEntityIds([gid(a), gid(b)]);
    assert.ok(groupSelection().ok);
    selectPickedGlobalId(gid(a));
    const out = ungroupSelection();
    assert.ok(out.ok && out.count === 1);
    assert.deepEqual(allGroups(), []);
    s().undo(MODEL_ID);
    assert.equal(allGroups().length, 1);
  });
});
