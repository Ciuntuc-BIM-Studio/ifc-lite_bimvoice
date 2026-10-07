/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The drafting session end to end, without a UI: commands started by name
 * or id, driven by clicks and typed input, write undoable entities to the
 * project document on the attached view.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetProject, useProjectStore } from '@/project/project-store';
import { clearDraftHistory, redoDrafts, undoDrafts } from './draft-store.js';
import {
  attachDraftingView, cancelCommand, clickDrawing, pressEnter, pressEscape, setAnnotationProviders, startDraftCommand,
  submitCommandLine, useDraftingSession, windowSelect,
} from './session.js';
import { arcThrough } from './commands/draw.js';
import type { EntityShape } from './types.js';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);
const shapes = (): EntityShape[] => useProjectStore.getState().drafts.map((d) => d.shape);
const TOL = 0.05;

beforeEach(() => {
  cancelCommand();
  resetProject();
  clearDraftHistory();
  useDraftingSession.setState({ selection: new Set(), ortho: false, history: [], lastCommandId: null });
  attachDraftingView(null, 'down', () => []);
  attachDraftingView('view-1', 'down', () => []);
});

describe('draw commands', () => {
  it('LINE draws one entity per segment and closes with C', () => {
    submitCommandLine('L', null);
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 4, y: 0 }, TOL, false);
    clickDrawing({ x: 4, y: 3 }, TOL, false);
    submitCommandLine('c', null);
    assert.equal(shapes().length, 3);
    assert.deepEqual(shapes()[2], { type: 'line', a: { x: 4, y: 3 }, b: { x: 0, y: 0 } });
    assert.equal(useDraftingSession.getState().commandId, null);
    assert.ok(useProjectStore.getState().drafts.every((d) => d.viewId === 'view-1'));
  });

  it('takes typed absolute, relative and polar coordinates in the screen-aligned user frame', () => {
    // A plan view: drawing y points DOWN on screen, so user "up" is −y in drawing space.
    startDraftCommand('polyline');
    submitCommandLine('1,2', null);
    submitCommandLine('@3,0', null);
    submitCommandLine('@2<90', null);
    pressEnter();
    const [pl] = shapes();
    assert.equal(pl.type, 'polyline');
    if (pl.type !== 'polyline') return;
    near(pl.pts[0].x, 1); near(pl.pts[0].y, -2);
    near(pl.pts[1].x, 4); near(pl.pts[1].y, -2);
    near(pl.pts[2].x, 4); near(pl.pts[2].y, -4);
  });

  it('a bare number is a distance toward the cursor, constrained by ortho', () => {
    useDraftingSession.setState({ ortho: true });
    startDraftCommand('line');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    submitCommandLine('5', { x: 10, y: 1 });
    pressEnter();
    assert.deepEqual(shapes()[0], { type: 'line', a: { x: 0, y: 0 }, b: { x: 5, y: 0 } });
  });

  it('CIRCLE takes a typed radius; RECTANGLE two corners', () => {
    startDraftCommand('circle');
    clickDrawing({ x: 1, y: 1 }, TOL, false);
    submitCommandLine('2.5', null);
    startDraftCommand('rectangle');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 1 }, TOL, false);
    assert.deepEqual(shapes()[0], { type: 'circle', c: { x: 1, y: 1 }, r: 2.5 });
    assert.equal(shapes()[1].type, 'polyline');
  });

  it('Enter on an idle line repeats the last command', () => {
    startDraftCommand('circle');
    pressEscape();
    pressEnter();
    assert.equal(useDraftingSession.getState().commandId, 'circle');
  });
});

describe('selection and modify commands', () => {
  beforeEach(() => {
    startDraftCommand('line');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 0 }, TOL, false);
    pressEnter();
  });

  it('clicks and windows select; MOVE displaces the selection', () => {
    clickDrawing({ x: 1, y: 0.01 }, TOL, false);
    assert.equal(useDraftingSession.getState().selection.size, 1);
    startDraftCommand('move');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 1, y: 1 }, TOL, false);
    assert.deepEqual(shapes()[0], { type: 'line', a: { x: 1, y: 1 }, b: { x: 3, y: 1 } });
    useDraftingSession.setState({ selection: new Set() });
    windowSelect({ x: -1, y: -1 }, { x: 4, y: 2 }, false, false);
    assert.equal(useDraftingSession.getState().selection.size, 1);
  });

  it('a modify command with nothing selected gathers the selection first', () => {
    startDraftCommand('erase');
    assert.equal(useDraftingSession.getState().selecting, true);
    clickDrawing({ x: 1, y: 0 }, TOL, false);
    pressEnter(); // selection done → ERASE starts
    pressEnter(); // ERASE confirms
    assert.equal(shapes().length, 0);
  });

  it('ROTATE by typed degrees is counter-clockwise on screen', () => {
    clickDrawing({ x: 1, y: 0 }, TOL, false);
    startDraftCommand('rotate');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    submitCommandLine('90', null);
    const [line] = shapes();
    assert.equal(line.type, 'line');
    // Screen-up on a plan is −y in drawing space.
    if (line.type === 'line') { near(line.b.x, 0); near(line.b.y, -2); }
  });

  it('undo and redo step through edits', () => {
    clickDrawing({ x: 1, y: 0 }, TOL, false);
    startDraftCommand('copy');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 0, y: 1 }, TOL, false);
    pressEnter();
    assert.equal(shapes().length, 2);
    undoDrafts();
    assert.equal(shapes().length, 1);
    redoDrafts();
    assert.equal(shapes().length, 2);
  });
});

describe('arcThrough', () => {
  it('passes through the three points, counter-clockwise from start to end', () => {
    const arc = arcThrough({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
    assert.ok(arc && arc.type === 'arc');
    if (arc?.type !== 'arc') return;
    near(arc.c.x, 0); near(arc.c.y, 0); near(arc.r, 1);
    near(arc.start, 0); near(arc.end, Math.PI);
    assert.equal(arcThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }), null);
  });
});

describe('annotation commands', () => {
  it('TEXT places a typed note at the picked point', () => {
    startDraftCommand('text');
    clickDrawing({ x: 2, y: 1 }, TOL, false);
    submitCommandLine('Living room', null);
    const [text] = shapes();
    assert.equal(text.type, 'text');
    if (text.type === 'text') { assert.equal(text.text, 'Living room'); assert.deepEqual(text.p, { x: 2, y: 1 }); }
  });

  it('DIMALIGNED takes two points and the dimension line location', () => {
    startDraftCommand('dimaligned');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 4, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 1 }, TOL, false);
    assert.equal(shapes()[0].type, 'dimension');
  });

  it('LEVEL reports the height the view gives for the point', () => {
    setAnnotationProviders(() => [], (p) => p.y + 10);
    startDraftCommand('level');
    clickDrawing({ x: 0, y: 2.5 }, TOL, false);
    pressEnter();
    const [level] = shapes();
    assert.ok(level.type === 'level' && level.value === 12.5);
  });

  it('HATCH fills the closed region around the picked point, with its islands', () => {
    const outer = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const island = [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }];
    setAnnotationProviders(() => [outer, island], () => 0);
    startDraftCommand('hatch');
    submitCommandLine('CROSS', null);
    clickDrawing({ x: 1, y: 1 }, TOL, false);
    pressEnter();
    const [hatch] = shapes();
    assert.ok(hatch.type === 'hatch');
    if (hatch.type === 'hatch') { assert.equal(hatch.pattern, 'CROSS'); assert.equal(hatch.loops.length, 2); }
  });
});
