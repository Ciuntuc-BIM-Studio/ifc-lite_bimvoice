/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * `element.copy`: a base point, then one copy per click (CAD COPY /
 * Revit's Copy "Multiple"), each copy one undo step with fresh GlobalIds,
 * the originals staying selected; Escape drops the base, then ends.
 */

import '@/test/setup-dom.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { cleanup, press, render } from '@/test/render.js';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { MODEL_ID, STOREY, seedModelingSession } from '@/test/modeling-session-fixture';
import { selectPickedGlobalId } from '@/components/viewer/viewport-selection';
import type { SnapResult } from '@/lib/snap/types';
import '../builtin.js';
import { commandPointerDown, commandPointerMove, getCommandRuntime } from '../runtime.js';
import { setRequestRemesh, type RemeshRequest } from '../transaction.js';

function Keys() { useKeyboardShortcuts(); return null; }

const at = (x: number, y: number): SnapResult => ({ local: [x, y], winner: null, guides: [], locked: false });
const click = (x: number, y: number) => act(() => { commandPointerMove(at(x, y)); commandPointerDown(at(x, y)); });
const round = (v: number) => +v.toFixed(6) || 0;
const undoDepth = () => useViewerStore.getState().undoStacks.get(MODEL_ID)?.length ?? 0;
const view = () => useViewerStore.getState().mutationViews.get(MODEL_ID)!;
const live = (type: string) => view().getNewEntities().filter((e) => e.type.toUpperCase() === type && !view().isDeleted(e.expressId));

function columns(): number[][] {
  const s = useViewerStore.getState();
  return live('IFCCOLUMN').map((e) => s.readEntityPosition(MODEL_ID, e.expressId)!.map(round))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function addColumn(x: number, y: number): number {
  const column = useViewerStore.getState().addColumn(MODEL_ID, STOREY, { Position: [x, y, 0], Width: 0.3, Depth: 0.3, Height: 2.5 });
  assert.ok('expressId' in column);
  return column.expressId;
}

let remeshes: RemeshRequest[] = [];
let restoreRemesh: () => void = () => {};

beforeEach(async () => {
  await seedModelingSession();
  remeshes = [];
  restoreRemesh = setRequestRemesh((_get, request) => { remeshes.push(request); });
  render(<Keys />);
  useViewerStore.getState().enterModelWorkspace({ storeyId: STOREY });
});
afterEach(() => {
  restoreRemesh();
  useViewerStore.getState().exitModelWorkspace();
  cleanup();
});

describe('element.copy', () => {
  it('copies from a base point to every clicked point, one undo step each, the originals kept selected', () => {
    const column = addColumn(1, 1);
    const globalId = toGlobalIdFromModels(useViewerStore.getState().models, MODEL_ID, column);
    act(() => selectPickedGlobalId(globalId));
    const before = undoDepth();
    useViewerStore.getState().startCommand('element.copy');
    assert.equal(getCommandRuntime().command?.id, 'element.copy');

    click(1, 1); // the base
    assert.deepEqual(columns(), [[1, 1, 0]], 'the base writes nothing');
    click(4, 1);
    click(4, 3);
    assert.deepEqual(columns(), [[1, 1, 0], [4, 1, 0], [4, 3, 0]]);
    assert.equal(getCommandRuntime().command?.id, 'element.copy', 'the command keeps copying');
    assert.ok(undoDepth() > before);
    assert.equal(remeshes.length, 2);
    assert.equal(remeshes[0].cause, 'created');
    assert.equal(new Set(live('IFCCOLUMN').map((e) => e.attributes[0])).size, 3, 'fresh GlobalIds');
    assert.equal(useViewerStore.getState().selectedEntityId, globalId, 'the original stays selected');

    useViewerStore.getState().undo(MODEL_ID);
    assert.deepEqual(columns(), [[1, 1, 0], [4, 1, 0]], 'one undo takes back the last copy only');
    useViewerStore.getState().undo(MODEL_ID);
    assert.deepEqual(columns(), [[1, 1, 0]], 'and the next one the copy before');
    useViewerStore.getState().redo(MODEL_ID);
    useViewerStore.getState().redo(MODEL_ID);
    assert.equal(columns().length, 3);

    // Escape drops the base, a second Escape ends.
    press(document.body, 'Escape');
    assert.equal(getCommandRuntime().command?.id, 'element.copy');
    press(document.body, 'Escape');
    assert.equal(getCommandRuntime().command, null);
  });

  it('with nothing selected, clicks write nothing', () => {
    addColumn(0, 0);
    act(() => selectPickedGlobalId(null));
    useViewerStore.getState().startCommand('element.copy');
    click(0, 0);
    click(2, 0);
    assert.equal(columns().length, 1);
  });
});
