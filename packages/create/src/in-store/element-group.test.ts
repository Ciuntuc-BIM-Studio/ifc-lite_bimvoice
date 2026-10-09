/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { IfcParser } from '@ifc-lite/parser';
import { MutablePropertyView, StoreEditor } from '@ifc-lite/mutations';
import { resolveSpatialAnchor } from './resolve-anchor.js';
import { addWallToStore } from './wall.js';
import { addColumnToStore } from './column.js';
import {
  addToGroupInStore, createGroupInStore, groupMembers, groupOfElement, groupableElements, modelGroups, removeFromGroupInStore, renameGroupInStore, ungroupInStore,
} from './element-group.js';

const SAMPLE = new URL('../../../../apps/viewer/public/samples/hello-wall.ifc', import.meta.url);

async function scene() {
  const bytes = readFileSync(SAMPLE);
  const store = await new IfcParser().parseColumnar(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { disableWorkerScan: true });
  const view = new MutablePropertyView(null, 'm');
  const editor = new StoreEditor(store, view);
  const anchor = resolveSpatialAnchor(store, 42, view);
  const wall = addWallToStore(editor, anchor, { Start: [0, 10, 0], End: [6, 10, 0], Thickness: 0.3, Height: 3 }).wallId;
  const a = addColumnToStore(editor, anchor, { Position: [0, 0, 0], Width: 0.4, Depth: 0.4, Height: 3 }).columnId;
  const b = addColumnToStore(editor, anchor, { Position: [5, 0, 0], Width: 0.4, Depth: 0.4, Height: 3 }).columnId;
  return { store, view, editor, anchor, wall, a, b };
}

describe('model groups', () => {
  it('groups elements as IfcGroup + IfcRelAssignsToGroup, adds, removes, renames and dissolves', async () => {
    const { store, view, editor, anchor, wall, a, b } = await scene();
    expect(groupableElements(store, [wall, a, 42], view, anchor.schema)).toEqual([wall, a]);
    const made = createGroupInStore(store, editor, anchor, 'Bay', [a, b]);
    const group = view.getNewEntity(made.groupId)!;
    expect(group.type).toBe('IfcGroup');
    expect(group.attributes[4]).toBe('Model group');
    expect(groupOfElement(store, a, view)).toBe(made.groupId);
    expect(groupOfElement(store, wall, view)).toBeNull();
    expect(new Set(groupMembers(store, made.groupId, view))).toEqual(new Set([a, b]));

    expect(new Set(addToGroupInStore(store, editor, anchor, made.groupId, [wall, a]))).toEqual(new Set([a, b, wall]));
    renameGroupInStore(editor, made.groupId, 'Bay A');
    expect(modelGroups(store, view)).toEqual([{ id: made.groupId, globalId: made.globalId, name: 'Bay A', members: expect.arrayContaining([a, b, wall]) }]);

    // Grouping a member again moves it out of its old group.
    const other = createGroupInStore(store, editor, anchor, 'Wall', [wall]);
    expect(groupOfElement(store, wall, view)).toBe(other.groupId);
    expect(new Set(groupMembers(store, made.groupId, view))).toEqual(new Set([a, b]));

    expect(removeFromGroupInStore(store, editor, made.groupId, [a])).toEqual({ members: [b], groupRemoved: false });
    expect(removeFromGroupInStore(store, editor, made.groupId, [b])).toEqual({ members: [], groupRemoved: true });
    expect(view.isDeleted(made.groupId) || !view.getNewEntity(made.groupId)).toBe(true);

    expect(ungroupInStore(store, editor, other.groupId)).toEqual([wall]);
    expect(modelGroups(store, view)).toEqual([]);
    expect(view.getNewEntities().filter((e) => e.type === 'IfcRelAssignsToGroup' && !view.isDeleted(e.expressId))).toHaveLength(0);
  });

  it('a group that loses every member to a new group is removed', async () => {
    const { store, view, editor, anchor, a, b } = await scene();
    const first = createGroupInStore(store, editor, anchor, 'One', [a]);
    const second = createGroupInStore(store, editor, anchor, 'Two', [a, b]);
    expect(second.removedGroups).toEqual([first.groupId]);
    expect(modelGroups(store, view).map((g) => g.name)).toEqual(['Two']);
    expect(() => createGroupInStore(store, editor, anchor, 'Empty', [])).toThrow(/at least one/);
  });
});
