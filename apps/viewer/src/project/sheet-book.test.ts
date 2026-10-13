/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addProjectSheet, projectDocument, resetProject, useProjectStore } from './project-store.js';
import { addViewport, regionViewport, updateSheet } from './sheets.js';
import { bookLayout, clearLiveSheets, KEPT_SHEETS, setLiveSheets, setSheetHidden, sheetAt, sheetsIn, SHEET_GAP_MM, useSheetBook } from './sheet-book.js';
import { parseProjectFile, serializeProject } from './project-file.js';
import type { ProjectSheet } from './types';

beforeEach(() => { resetProject(); clearLiveSheets(); });

const sheet = (id: string, number: string, extra: Partial<ProjectSheet> = {}): ProjectSheet => ({ id, number, name: id, createdAt: 0, ...extra });

describe('sheets canvas', () => {
  it('stacks the sheets by number, each its own paper, one gap apart', () => {
    const layout = bookLayout([sheet('c', 'A-110', { paper: 'A3' }), sheet('a', 'A-101'), sheet('b', 'A-102', { paper: 'A4', orientation: 'portrait' })]);
    assert.deepEqual(layout.map((p) => p.sheet.id), ['a', 'b', 'c']);
    assert.deepEqual(layout.map((p) => [p.x, p.y, p.w, p.h]), [
      [0, 0, 841, 594],
      [0, 594 + SHEET_GAP_MM, 210, 297],
      [0, 594 + 297 + 2 * SHEET_GAP_MM, 420, 297],
    ]);
    assert.equal(sheetAt(layout, { x: 100, y: 700 })?.sheet.id, 'b');
    assert.equal(sheetAt(layout, { x: 100, y: 610 }), null, 'the gap is no sheet');
    assert.deepEqual(sheetsIn(layout, { x0: 0, y0: 500, x1: 300, y1: 700 }).map((p) => p.sheet.id), ['a', 'b']);
  });

  it('leaves hidden sheets off the canvas, except the active one', () => {
    const sheets = [sheet('a', '1'), sheet('b', '2', { hidden: true }), sheet('c', '3')];
    assert.deepEqual(bookLayout(sheets).map((p) => p.sheet.id), ['a', 'c']);
    assert.deepEqual(bookLayout(sheets, 'b').map((p) => p.sheet.id), ['a', 'b', 'c']);
  });

  it('keeps the drawings of the sheets on screen and of the last few seen', () => {
    setLiveSheets(['a', 'b']);
    assert.deepEqual(useSheetBook.getState().live, ['a', 'b']);
    for (let i = 0; i < KEPT_SHEETS + 3; i++) setLiveSheets([`s${i}`]);
    const live = useSheetBook.getState().live;
    assert.equal(live.length, KEPT_SHEETS);
    assert.equal(live[0], `s${KEPT_SHEETS + 2}`, 'the one on screen first');
    assert.ok(!live.includes('a'), 'the oldest are let go');
    clearLiveSheets();
    assert.deepEqual(useSheetBook.getState().live, []);
  });

  it('hides a sheet through the project file', () => {
    addProjectSheet('Plans');
    const id = useProjectStore.getState().sheets[0].id;
    setSheetHidden(id, true);
    assert.equal(parseProjectFile(serializeProject(projectDocument())).sheets[0].hidden, true);
    setSheetHidden(id, false);
    assert.equal('hidden' in useProjectStore.getState().sheets[0], false);
  });
});

describe('region viewports', () => {
  it('centres on the region and takes its size at the viewport scale', () => {
    const vp = { id: 'v', viewId: 'p', x: 100, y: 80, scale: 50, width: 0, height: 0, center: null };
    const region = [{ x: 2, y: 1 }, { x: 12, y: 1 }, { x: 12, y: 5 }, { x: 2, y: 5 }];
    // 10 m × 4 m at 1:50 is 200 × 80 mm.
    assert.deepEqual(regionViewport(vp, region), { ...vp, center: { x: 7, y: 3 }, width: 200, height: 80 });
    assert.equal(regionViewport(vp, undefined), vp);
  });

  it('keeps the region link through the project file', () => {
    addProjectSheet('Plans');
    const s = useProjectStore.getState().sheets[0];
    addViewport(s.id, 'plan-1', { x: 100, y: 100 }, 100, 'draft-region-1');
    updateSheet(s.id, { name: 'Plans' });
    assert.equal(parseProjectFile(serializeProject(projectDocument())).sheets[0].viewports?.[0].regionId, 'draft-region-1');
  });
});
