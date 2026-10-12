/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Annotation drafting: continued dimensions, ortho while Ctrl is held,
 * dimension lines as snap targets, two-segment leaders, section marks that
 * stay on the plans, parametric level marks.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resetProject, useProjectStore } from '@/project/project-store';
import { sectionMarks } from '@/project/section-marks';
import type { ProjectView } from '@/project/types';
import { clearDraftHistory, editDrafts, setLevelResolver } from './draft-store.js';
import {
  attachDraftingView, cancelCommand, clickDrawing, pressEnter, setAnnotationProviders, setOrthoHeld, setWorkPlaneProvider, startDraftCommand,
  submitCommandLine, useDraftingSession,
} from './session.js';
import { dimensionLayout, snapShapes } from './annotation.js';
import { findSnap } from './snaps.js';
import { moveGrip } from './grips.js';
import type { AnnotationShape, EntityShape } from './types.js';

const shapes = (): EntityShape[] => useProjectStore.getState().drafts.map((d) => d.shape);
const TOL = 0.05;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≉ ${b}`);

beforeEach(() => {
  cancelCommand();
  resetProject();
  clearDraftHistory();
  useDraftingSession.setState({ selection: new Set(), ortho: false, orthoHeld: false, history: [], lastCommandId: null });
  attachDraftingView(null, 'down', () => []);
  attachDraftingView('view-1', 'down', () => []);
});

describe('continued dimensions', () => {
  it('after the first dimension, each point adds the next one on the same line, measured the same way', () => {
    startDraftCommand('dimlinear');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 3, y: 0 }, TOL, false);
    clickDrawing({ x: 1, y: 2 }, TOL, false);
    clickDrawing({ x: 7, y: 0.4 }, TOL, false);
    clickDrawing({ x: 12, y: -0.3 }, TOL, false);
    pressEnter();
    const dims = shapes() as Extract<AnnotationShape, { type: 'dimension' }>[];
    assert.equal(dims.length, 3);
    // Same dimension line (y = 2), horizontal, end to end.
    const lines = dims.map((d) => dimensionLayout(d).lines[2]);
    for (const l of lines) { near(l.a.y, 2); near(l.b.y, 2); }
    near(lines[1].a.x, 3);
    near(lines[2].a.x, 7);
    assert.deepEqual(dims.map((d) => dimensionLayout(d).label), ['3.00', '4.00', '5.00']);
    assert.equal(useDraftingSession.getState().commandId, null);
  });

  it('S makes a single dimension', () => {
    startDraftCommand('dimaligned');
    submitCommandLine('S', null);
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 4, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 1 }, TOL, false);
    assert.equal(shapes().length, 1);
    assert.equal(useDraftingSession.getState().commandId, null);
  });

  it('a held direction turns with the dimension and is read back from the file', () => {
    const d: AnnotationShape = { type: 'dimension', variant: 'aligned', a: { x: 0, y: 0 }, b: { x: 3, y: 1 }, at: { x: 0, y: 2 }, dir: { x: 1, y: 0 }, height: 0.25 };
    // Measured along x, not along the slanted points.
    assert.equal(dimensionLayout(d).label, '3.00');
  });
});

describe('ortho with Ctrl held', () => {
  it('constrains the next point while held, and only then', () => {
    submitCommandLine('L', null);
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    setOrthoHeld(true);
    clickDrawing({ x: 5, y: 1 }, TOL, false);
    setOrthoHeld(false);
    clickDrawing({ x: 6, y: 4 }, TOL, false);
    pressEnter();
    const [a, b] = shapes();
    assert.ok(a.type === 'line' && a.b.y === 0 && a.b.x === 5);
    assert.ok(b.type === 'line' && b.b.x === 6 && b.b.y === 4);
  });

  it('a snapped point stays where it snapped, ortho or not', () => {
    useDraftingSession.setState({ ortho: true });
    submitCommandLine('L', null);
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 5, y: 1 }, TOL, false, true);
    pressEnter();
    const [a] = shapes();
    assert.ok(a.type === 'line' && a.b.y === 1);
  });
});

describe('dimension lines as snap targets', () => {
  it('offers its dimension line, so a new dimension lands on it', () => {
    const d: AnnotationShape = { type: 'dimension', variant: 'linear', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, at: { x: 2, y: 3 }, height: 0.25 };
    const [line] = snapShapes(d);
    assert.ok(line.type === 'line' && line.a.y === 3 && line.b.y === 3);
    const hit = findSnap({ x: 6.02, y: 3.03 }, snapShapes({ ...d, b: { x: 8, y: 0 } }), null, { tolerance: 0.1, modes: new Set(['nearest']) });
    assert.ok(hit && Math.abs(hit.point.y - 3) < 1e-9);
  });
});

describe('two-segment leaders', () => {
  it('the arrow segment goes any way, the landing is held horizontal, then the text', () => {
    startDraftCommand('leader');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 1.5 }, TOL, false);
    clickDrawing({ x: 4, y: 1.8 }, TOL, false);
    submitCommandLine('Note', null);
    const [l] = shapes();
    assert.ok(l.type === 'leader');
    if (l.type === 'leader') assert.deepEqual(l.pts, [{ x: 0, y: 0 }, { x: 2, y: 1.5 }, { x: 4, y: 1.5 }]);
  });

  it('F frees the landing; Enter after the elbow writes a single segment', () => {
    startDraftCommand('leader');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 2, y: 1.5 }, TOL, false);
    submitCommandLine('F', null);
    clickDrawing({ x: 4, y: 1.8 }, TOL, false);
    submitCommandLine('A', null);
    startDraftCommand('leader');
    clickDrawing({ x: 10, y: 0 }, TOL, false);
    clickDrawing({ x: 11, y: 1 }, TOL, false);
    pressEnter();
    submitCommandLine('B', null);
    const [a, b] = shapes();
    assert.ok(a.type === 'leader' && a.pts[2].y === 1.8);
    assert.ok(b.type === 'leader' && b.pts.length === 2);
  });
});

describe('section marks', () => {
  it('SECTION keeps its line on the section view, and plans show it as a mark looking its way', () => {
    const plan = { axis: 'y' as const, position: 1.2, flipped: false };
    const planView = { id: 'view-1', kind: 'plan', name: 'Plan', scale: 100 } as unknown as ProjectView;
    setWorkPlaneProvider(() => plan, () => planView);
    startDraftCommand('sectionline');
    clickDrawing({ x: 0, y: 0 }, TOL, false);
    clickDrawing({ x: 10, y: 0 }, TOL, false);
    clickDrawing({ x: 5, y: 3 }, TOL, false);
    const views = useProjectStore.getState().views;
    const section = views.find((v) => v.kind === 'section');
    assert.ok(section && section.kind === 'section' && section.marker);
    const [mark] = sectionMarks(planView, plan, views);
    assert.ok(mark);
    near(Math.hypot(mark.b.x - mark.a.x, mark.b.y - mark.a.y), 10);
    // Looking across the line, toward (or away from) the picked side — square to the line either way.
    near(mark.look.x, 0);
  });
});

describe('parametric level marks', () => {
  it('measures at its reference; the symbol goes anywhere; moving the reference re-measures', () => {
    setAnnotationProviders(() => [], (p) => p.y + 10);
    setLevelResolver('view-1', (p) => p.y + 10);
    startDraftCommand('level');
    clickDrawing({ x: 0, y: 2.5 }, TOL, false);
    clickDrawing({ x: 6, y: 4 }, TOL, false);
    pressEnter();
    const [d] = useProjectStore.getState().drafts;
    assert.ok(d.shape.type === 'level');
    if (d.shape.type !== 'level') return;
    assert.equal(d.shape.value, 12.5);
    assert.deepEqual(d.shape.p, { x: 6, y: 4 });
    editDrafts({ update: new Map([[d.id, moveGrip(d.shape, 'ref', { x: 0, y: 3 })]]) });
    const [moved] = shapes();
    assert.ok(moved.type === 'level' && moved.value === 13 && moved.p.y === 4);
    // The view's heights change (a storey raised): its open view brings the marks up to date.
    setLevelResolver('view-1', (p) => p.y + 11);
    const [raised] = shapes();
    assert.ok(raised.type === 'level' && raised.value === 14);
    setLevelResolver('view-1', null);
  });
});
