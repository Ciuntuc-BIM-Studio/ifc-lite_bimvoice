/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Per-view drawings: a view's depth decides its projection, entries patch
 * and drop per view, and plane keys are stable for identical planes.
 */

import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dropViewDrawing, patchViewDrawing, planeKey, useViewDrawings, viewDisplayOverrides } from './view-drawings.js';
import type { ProjectView } from './types.js';

const base = { id: 'v', name: 'v', createdAt: 0 };
const plan: ProjectView = { ...base, kind: 'plan', level: { name: 'L0', elevation: 0, storeyGlobalIds: [] }, cutHeight: 1.2 };
const elevation: ProjectView = { ...base, kind: 'elevation', direction: 'south' };

beforeEach(() => useViewDrawings.setState({ byView: {} }));

describe('viewDisplayOverrides', () => {
  it('sees a plan down to its floor (as deep as its cut), and projects a section / elevation automatically, by default', () => {
    assert.deepEqual(viewDisplayOverrides(plan), { showConstructionProjection: true, constructionProjectionDepth: 1.2 });
    assert.deepEqual(viewDisplayOverrides({ ...plan, cutHeight: 1.5 }), { showConstructionProjection: true, constructionProjectionDepth: 1.5 });
    assert.deepEqual(viewDisplayOverrides({ ...plan, viewDepth: 0 }), { showConstructionProjection: false, constructionProjectionDepth: 0 });
    assert.deepEqual(viewDisplayOverrides(elevation), { showConstructionProjection: true, constructionProjectionDepth: null });
  });

  it('projects exactly the view depth when one is set, and nothing at depth 0', () => {
    assert.deepEqual(viewDisplayOverrides({ ...plan, viewDepth: 1.2 }), { showConstructionProjection: true, constructionProjectionDepth: 1.2 });
    assert.deepEqual(viewDisplayOverrides({ ...elevation, viewDepth: 0 }), { showConstructionProjection: false, constructionProjectionDepth: 0 });
  });
});

describe('view drawing entries', () => {
  it('patches one view without touching another, and drops it', () => {
    patchViewDrawing('a', { status: 'generating', progress: 40, phase: 'cut' });
    patchViewDrawing('b', { status: 'ready' });
    patchViewDrawing('a', { status: 'ready' });
    assert.equal(useViewDrawings.getState().byView.a.status, 'ready');
    assert.equal(useViewDrawings.getState().byView.a.progress, 40);
    dropViewDrawing('a');
    assert.deepEqual(Object.keys(useViewDrawings.getState().byView), ['b']);
  });
});

describe('planeKey', () => {
  it('is equal for equal planes and empty for none', () => {
    assert.equal(planeKey({ axis: 'down', position: 10, flipped: false }), planeKey({ axis: 'down', position: 10, flipped: false }));
    assert.notEqual(planeKey({ axis: 'down', position: 10, flipped: false }), planeKey({ axis: 'down', position: 10, flipped: true }));
    assert.equal(planeKey(null), '');
  });
});
