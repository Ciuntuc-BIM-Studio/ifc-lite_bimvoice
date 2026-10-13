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
import { addAxisStyle, removeAxisStyle, setElementOverride, updateAxisStyle } from '@/project/drafting-standards';
import { DEFAULT_AXIS_STYLE } from './styles';
import { clearDraftHistory, redoDrafts, undoDrafts } from './draft-store.js';
import {
  attachDraftingView, cancelCommand, clickDrawing, pressEnter, pressEscape, setAnnotationProviders, setCurrentStyles, setModelEditRoute, startDraftCommand,
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

  it('AXIS draws labelled axes that count on, with the typed bubble, ends and label', () => {
    startDraftCommand('axis');
    submitCommandLine('L', null);
    submitCommandLine('A', null);
    submitCommandLine('S', null);
    submitCommandLine('START', null);
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 0, y: 10 }, TOL, false);
    clickDrawing({ x: 5, y: 0 }, TOL, false);
    clickDrawing({ x: 5, y: 10 }, TOL, false);
    // Enter drops a started axis, the second ends the command.
    clickDrawing({ x: 9, y: 0 }, TOL, false);
    pressEnter();
    pressEnter();
    const axes = shapes();
    assert.equal(axes.length, 2);
    assert.ok(axes.every((a) => a.type === 'axis' && a.bubble === 'square' && a.ends === 'start' && a.lineType === 'dashdot'));
    assert.deepEqual(axes.map((a) => (a.type === 'axis' ? a.label : '')), ['A', 'B']);
    assert.equal(useDraftingSession.getState().commandId, null);
    // The typed options are this run's, kept on each axis as overrides of its type.
    const [first] = useProjectStore.getState().drafts;
    assert.equal(first.params.axisStyle, 'standard');
    assert.equal(first.params['o.bubble'], 'square');
    assert.equal(first.params['o.ends'], 'start');
    assert.equal(first.params['o.lineType'], undefined);
    // Back to the first label for the tests after.
    setCurrentStyles({ firstAxisLabel: '1' });
  });

  it('AXIS draws the current axis type, and the type governs its axes (overrides stay)', () => {
    const typeId = addAxisStyle({ ...DEFAULT_AXIS_STYLE, bubble: 'square', ends: 'none', lineType: 'dashed', size: 12, firstLabel: 'A' }, 'Grid B');
    setCurrentStyles({ axisStyle: typeId, firstAxisLabel: 'A' });
    try {
      startDraftCommand('axis');
      clickDrawing({ x: 0, y: 0 }, TOL, false);
      clickDrawing({ x: 0, y: 10 }, TOL, false);
      // A run starts from the type again: C here draws circles for this run only.
      submitCommandLine('C', null);
      clickDrawing({ x: 5, y: 0 }, TOL, false);
      clickDrawing({ x: 5, y: 10 }, TOL, false);
      pressEnter();
      const [a, b] = useProjectStore.getState().drafts;
      assert.ok(a.shape.type === 'axis' && b.shape.type === 'axis');
      if (a.shape.type !== 'axis' || b.shape.type !== 'axis') return;
      assert.equal(a.params.axisStyle, typeId);
      assert.deepEqual([a.shape.label, a.shape.bubble, a.shape.ends, a.shape.lineType], ['A', 'square', 'none', 'dashed']);
      near(a.shape.size, 1.2); // 12 mm at 1:100
      assert.equal(Object.keys(a.params).filter((k) => k.startsWith('o.')).length, 0);
      assert.equal(b.shape.bubble, 'circle');
      assert.equal(b.params['o.bubble'], 'circle');

      // Editing the type redraws its axes, except what an axis overrides.
      setElementOverride(new Set([a.id]), 'ends', 'start');
      updateAxisStyle(typeId, { ends: 'both', bubble: 'circle', size: 8, lineType: 'dotted' });
      const [a2, b2] = useProjectStore.getState().drafts;
      assert.ok(a2.shape.type === 'axis' && b2.shape.type === 'axis');
      if (a2.shape.type !== 'axis' || b2.shape.type !== 'axis') return;
      assert.deepEqual([a2.shape.bubble, a2.shape.ends, a2.shape.lineType], ['circle', 'start', 'dotted']);
      near(a2.shape.size, 0.8);
      assert.equal(b2.shape.ends, 'both');

      // T picks a type by name; its labels restart at its first label.
      startDraftCommand('axis');
      submitCommandLine('T', null);
      submitCommandLine('standard', null);
      clickDrawing({ x: 9, y: 0 }, TOL, false);
      clickDrawing({ x: 9, y: 10 }, TOL, false);
      pressEnter();
      const c = useProjectStore.getState().drafts[2];
      assert.ok(c.shape.type === 'axis' && c.shape.label === '1' && c.shape.bubble === 'circle' && c.params.axisStyle === 'standard');

      // A removed type leaves its axes on Standard.
      removeAxisStyle(typeId);
      assert.ok(useProjectStore.getState().drafts.every((d) => d.params.axisStyle === 'standard'));
    } finally {
      setCurrentStyles({ axisStyle: 'standard', firstAxisLabel: '1' });
    }
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

describe('modify commands on model elements', () => {
  it('with nothing drafted selected, MOVE / ERASE go to the model route; with a drafted selection they stay drafting commands', () => {
    const routed: string[] = [];
    setModelEditRoute((id) => { routed.push(id); return id !== 'mirror'; });
    try {
      startDraftCommand('move');
      submitCommandLine('E', null);
      assert.deepEqual(routed, ['move', 'erase']);
      assert.equal(useDraftingSession.getState().commandId, null, 'the route took them');
      // A command the route declines waits for a drafted selection as before.
      startDraftCommand('mirror');
      assert.equal(useDraftingSession.getState().commandId, 'mirror');
      cancelCommand();

      submitCommandLine('L', null);
      clickDrawing({ x: 0, y: 0 }, TOL, false);
      clickDrawing({ x: 4, y: 0 }, TOL, false);
      pressEnter();
      useDraftingSession.setState({ selection: new Set([useProjectStore.getState().drafts[0].id]) });
      routed.length = 0;
      startDraftCommand('move');
      assert.deepEqual(routed, [], 'drafted entities selected: no route');
      assert.equal(useDraftingSession.getState().commandId, 'move');
      cancelCommand();
    } finally {
      setModelEditRoute(null);
    }
  });
});
