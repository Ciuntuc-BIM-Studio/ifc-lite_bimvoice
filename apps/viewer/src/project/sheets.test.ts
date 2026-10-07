/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sheets: paper sizes, viewports placed / moved / removed, boxes that fit
 * the drawing until sized by hand, and the layout surviving a project file.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addProjectSheet, projectDocument, resetProject, useProjectStore } from './project-store.js';
import { addViewport, paperOf, removeViewport, sheetsShowing, updateSheet, updateViewport, viewportBox } from './sheets.js';
import { parseProjectFile, serializeProject } from './project-file.js';

beforeEach(() => resetProject());

const sheet = () => useProjectStore.getState().sheets[0];

describe('sheets', () => {
  it('sizes the paper by format and orientation (A1 landscape by default)', () => {
    addProjectSheet('Plans');
    assert.deepEqual(paperOf(sheet()), { w: 841, h: 594 });
    updateSheet(sheet().id, { paper: 'A3', orientation: 'portrait' });
    assert.deepEqual(paperOf(sheet()), { w: 297, h: 420 });
  });

  it('places, moves, rescales and removes viewports', () => {
    addProjectSheet('Plans');
    const id = addViewport(sheet().id, 'view-1', { x: 200, y: 150 }, 100);
    updateViewport(sheet().id, id, { x: 250, scale: 50 });
    assert.deepEqual({ ...sheet().viewports?.[0] }, { id, viewId: 'view-1', x: 250, y: 150, scale: 50, width: 0, height: 0, center: null });
    assert.equal(sheetsShowing('view-1').length, 1);
    removeViewport(sheet().id, id);
    assert.equal(sheet().viewports?.length, 0);
  });

  it('fits the viewport box to the drawing until it is sized by hand', () => {
    addProjectSheet('Plans');
    const id = addViewport(sheet().id, 'v', { x: 0, y: 0 }, 100);
    const bounds = { min: { x: 0, y: 0 }, max: { x: 20, y: 10 } };
    // 20 m × 10 m at 1:100 is 200 × 100 mm, plus a 10 mm margin each side.
    assert.deepEqual(viewportBox(sheet().viewports![0], bounds), { width: 220, height: 120 });
    updateViewport(sheet().id, id, { width: 150, height: 90 });
    assert.deepEqual(viewportBox(sheet().viewports![0], bounds), { width: 150, height: 90 });
  });

  it('keeps paper, title block and viewports through the project file', () => {
    addProjectSheet('Plans');
    updateSheet(sheet().id, { paper: 'A2', titleBlock: { drawnBy: 'IC' } });
    addViewport(sheet().id, 'view-1', { x: 100, y: 100 }, 200);
    const back = parseProjectFile(serializeProject(projectDocument())).sheets[0];
    assert.equal(back.paper, 'A2');
    assert.equal(back.titleBlock?.drawnBy, 'IC');
    assert.equal(back.viewports?.[0].scale, 200);
  });
});
