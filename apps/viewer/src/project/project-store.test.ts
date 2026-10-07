/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project store: first model load creates the default views, a later
 * load only adds plans, and view/sheet edits keep names unique.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addProjectSheet,
  duplicateProjectView,
  removeProjectItem,
  renameProjectItem,
  resetProject,
  syncProjectWithModels,
  updateProjectView,
  useProjectStore,
} from './project-store.js';

const arch = { key: 'hash-arch', name: 'arch.ifc' };
const struct = { key: 'hash-struct', name: 'struct.ifc' };

beforeEach(() => resetProject());

describe('syncProjectWithModels', () => {
  it('gives a new project the default views for its levels', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }, { name: 'L1', elevation: 3 }]);
    const s = useProjectStore.getState();
    assert.equal(s.views.filter((v) => v.kind === 'plan').length, 2);
    assert.equal(s.views.filter((v) => v.kind === 'elevation').length, 4);
    assert.deepEqual(s.models, [arch]);
    assert.equal(s.dirty, true);
  });

  it('adds only a plan for a level a federated model brings, keeping user views', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }]);
    renameProjectItem(useProjectStore.getState().views[0].id, 'Ground');
    syncProjectWithModels([arch, struct], [{ name: 'L0', elevation: 0 }, { name: 'Foundation', elevation: -1.5 }]);
    const plans = useProjectStore.getState().views.filter((v) => v.kind === 'plan').map((v) => v.name);
    assert.deepEqual(plans, ['Ground', 'Foundation']);
    assert.deepEqual(useProjectStore.getState().models, [arch, struct]);
  });

  it('does not write the store when nothing changed', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }]);
    const before = useProjectStore.getState();
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }]);
    assert.equal(useProjectStore.getState(), before);
  });
});

describe('view and sheet edits', () => {
  it('duplicates a view next to it with a unique name', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }]);
    const [first] = useProjectStore.getState().views;
    const copyId = duplicateProjectView(first.id);
    const views = useProjectStore.getState().views;
    assert.equal(views[1].id, copyId);
    assert.equal(views[1].name, 'L0 Copy');
    assert.equal(views[1].auto, false);
  });

  it('keeps view names unique on rename', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }, { name: 'L1', elevation: 3 }]);
    const [l1, l0] = useProjectStore.getState().views;
    renameProjectItem(l1.id, l0.name);
    assert.equal(useProjectStore.getState().views[0].name, 'L0 (2)');
  });

  it('numbers new sheets in series and removes them', () => {
    const a = addProjectSheet();
    addProjectSheet();
    assert.deepEqual(useProjectStore.getState().sheets.map((s) => s.number), ['A-101', 'A-102']);
    removeProjectItem(a);
    assert.equal(addProjectSheet() && useProjectStore.getState().sheets.at(-1)?.number, 'A-101');
  });

  it('updates one view\'s settings but never its id or kind', () => {
    syncProjectWithModels([arch], [{ name: 'L0', elevation: 0 }]);
    const [plan] = useProjectStore.getState().views;
    updateProjectView(plan.id, { cutHeight: 0.9, viewDepth: 1.5 });
    const updated = useProjectStore.getState().views[0];
    assert.equal(updated.kind, 'plan');
    assert.equal(updated.id, plan.id);
    assert.equal(updated.kind === 'plan' && updated.cutHeight, 0.9);
    assert.equal(updated.viewDepth, 1.5);
  });
});
